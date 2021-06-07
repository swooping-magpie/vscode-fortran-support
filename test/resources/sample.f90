program main

  use main

  implicit none
  
  integer :: x, y

  call say_hello(x, y)

contains

  subroutine say_hello(a,b)
    integer :: a,b

    print *, "Hello, World!"
  end subroutine say_hello
  
end program main