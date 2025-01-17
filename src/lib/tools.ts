import * as os from 'os';
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as cp from 'child_process';
import { LoggingService } from '../services/logging-service';
import { isString, isArrayOfString } from './helper';

export const EXTENSION_ID = 'fortran';
export const LANG_SERVER_TOOL_ID = 'fortran-language-server';
export const FORMATTERS = ['Disabled', 'findent', 'fprettify'];

// Platform-specific environment variable delimiter
export const envDelimiter: string = process.platform === 'win32' ? ';' : ':';

/**
 * Generates a document selector for the supported file and languages
 * if the folder is present then a glob pattern for all the files in the workspace
 * is included
 *
 * @warning this should match the value on the package.json otherwise the extension
 * won't work at all
 *
 * @param folder `optional` WorkspaceFolder to search
 * @returns tuple of DocumentSelector
 */
export function FortranDocumentSelector(folder?: vscode.WorkspaceFolder) {
  if (folder) {
    return [
      { scheme: 'file', language: 'FortranFreeForm', pattern: `${folder.uri.fsPath}/**/*` },
      { scheme: 'file', language: 'FortranFixedForm', pattern: `${folder.uri.fsPath}/**/*` },
    ];
  } else {
    return [
      { scheme: 'file', language: 'FortranFreeForm' },
      { scheme: 'file', language: 'FortranFixedForm' },
    ];
  }
}

/**
 * Install a package either a Python pip package or a VS Marketplace Extension.
 *
 * For the Python install supply the name of the package in PyPi
 * e.g. fortran-language-server
 *
 * For the VS Extension to be installed supply the id of the extension
 * e.g 'hansec.fortran-ls'
 *
 * @param tool name of the tool e.g. fortran-language-server
 * @param msg message for installing said package
 * @param toolType type of tool, supports `Python` (through pip) and 'VSExt'
 * @param opts options for the prompt. "Install" and "Don't Show Again" are coded
 * @param logger log channel output
 * @param action a void function for an action to perform when "Don't Show Again" is pressed
 */
export function promptForMissingTool(
  tool: string,
  msg: string,
  toolType: string,
  opts: string[],
  logger?: LoggingService,
  action?: () => void
) {
  const items = ['Install'];
  return vscode.window.showInformationMessage(msg, ...opts).then(selected => {
    if (selected === 'Install') {
      switch (toolType) {
        case 'Python':
          installPythonTool(tool, logger);
          break;

        case 'VSExt':
          logger.logInfo(`Installing VS Marketplace Extension with id: ${tool}`);
          vscode.commands.executeCommand('extension.open', tool);
          vscode.commands.executeCommand('workbench.extensions.installExtension', tool);
          logger.logInfo(`Extension ${tool} successfully installed`);
          break;

        default:
          logger.logError(`Failed to install tool: ${tool}`);
          vscode.window.showErrorMessage(`Failed to install tool: ${tool}`);
          break;
      }
    } else if (selected === "Don't Show Again") {
      action();
    }
  });
}

/**
 * A wrapper around a call to `pip` for installing external tools.
 * Does not explicitly check if `pip` is installed.
 *
 * @param pyPackage name of python package in PyPi
 * @param logger `optional` logging channel for output
 */
export function installPythonTool(pyPackage: string, logger?: LoggingService) {
  const installProcess = cp.spawn('pip', 'install --user --upgrade '.concat(pyPackage).split(' '));
  installProcess.stdout.on('data', data => {
    logger.logInfo(`pip install: ${data}`);
  });
  installProcess.on('exit', (code, signal) => {
    if (code !== 0) {
      logger.logError(
        `Python package ${pyPackage} failed to install with code: ${code}, signal: ${signal}`
      );
    } else {
      logger.logInfo(`Successfully installed ${pyPackage}.`);
    }
  });
  installProcess.on('error', err => {
    logger.logError(`${err}`);
  });
}

/**
 * Resolve VSCode internal variables `workspaceFolder`, `env`, `config`, etc.
 *
 * @param input string for which we will substitute internal variables
 * @param additionalEnvironment Additional environmental variables
 * @returns
 */
export function resolveVariables(
  input: string | undefined,
  additionalEnvironment?: { [key: string]: string | string[] }
): string {
  if (!input) {
    return '';
    // return new Promise<string>((resolve) => { resolve("") });
  }

  // Replace environment and configuration variables.
  let regexp: () => RegExp = () =>
    /\$\{((env|config|workspaceFolder|file|fileDirname|fileBasenameNoExtension)(\.|:))?(.*?)\}/g;
  let ret: string = input;
  const cycleCache: Set<string> = new Set();
  while (!cycleCache.has(ret)) {
    cycleCache.add(ret);
    ret = ret.replace(
      regexp(),
      (match: string, ignored1: string, varType: string, ignored2: string, name: string) => {
        // Historically, if the variable didn't have anything before the "." or ":"
        // it was assumed to be an environment variable
        // We ignore that and we make it to be workspacefolder
        if (!varType) {
          varType = 'workspaceFolder';
        }
        let newValue: string | undefined;
        switch (varType) {
          case 'env': {
            if (additionalEnvironment) {
              const v: string | string[] | undefined = additionalEnvironment[name];
              if (isString(v)) {
                newValue = v;
              } else if (input === match && isArrayOfString(v)) {
                newValue = v.join(envDelimiter);
              }
            }
            if (newValue === undefined) {
              newValue = process.env[name];
            }
            break;
          }
          case 'config': {
            const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration();
            if (config) {
              newValue = config.get<string>(name);
            }
            break;
          }
          case 'workspaceFolder': {
            // Only replace ${workspaceFolder:name} variables for now.
            // We may consider doing replacement of ${workspaceFolder} here later, but we would have to update the language server and also
            // intercept messages with paths in them and add the ${workspaceFolder} variable back in (e.g. for light bulb suggestions)
            if (name && vscode.workspace && vscode.workspace.workspaceFolders) {
              let folder: vscode.WorkspaceFolder | undefined =
                vscode.workspace.workspaceFolders.find(
                  folder => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase()
                );
              if (folder) {
                newValue = folder.uri.fsPath;
              }
              // If ${workspaceFolder:workspacename} fails or doesn't exist go to
              // the first availbale workspaceFolder and assign its path
              else {
                folder = vscode.workspace.workspaceFolders[0];
                newValue = folder.uri.fsPath;
              }
            }
            break;
          }
          default: {
            assert.fail('unknown varType matched');
          }
        }
        return newValue !== undefined ? newValue : match;
      }
    );
  }

  // Resolve '~' at the start of the path.
  regexp = () => /^~/g;
  ret = ret.replace(regexp(), (match: string, name: string) => os.homedir());

  return ret;
  // return new Promise<string>((resolve) => { resolve(ret) });
}
