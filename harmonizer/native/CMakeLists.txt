cmake_minimum_required(VERSION 3.20)

project(Harmonizer VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

include(FetchContent)
if(POLICY CMP0169)
  cmake_policy(SET CMP0169 OLD)
endif()
find_package(PkgConfig REQUIRED)
find_package(Threads REQUIRED)

pkg_check_modules(PORTAUDIO REQUIRED IMPORTED_TARGET portaudio-2.0)
pkg_check_modules(AUBIO REQUIRED IMPORTED_TARGET aubio)

# Rubber Band 4 introduced the low-latency LiveShifter used by this project.
# Ubuntu 24.04 and MSYS2 still package Rubber Band 3, so build the official
# single-file implementation to keep setup identical across platforms.
FetchContent_Declare(
  rubberband
  URL https://github.com/breakfastquay/rubberband/archive/refs/tags/v4.0.0.tar.gz
  URL_HASH SHA256=24300f48a8014b7c863b573a9647e61b1b19b37875e2cdd92005e64c6424d266
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_GetProperties(rubberband)
if(NOT rubberband_POPULATED)
  FetchContent_Populate(rubberband)
endif()

add_library(rubberband_live STATIC
  "${rubberband_SOURCE_DIR}/single/RubberBandSingle.cpp"
)
target_include_directories(rubberband_live PUBLIC "${rubberband_SOURCE_DIR}")

add_executable(harmonizer_web
  harmonizer_web.cpp
  harmonizer_rubberband_engine.hpp
)
target_compile_options(harmonizer_web PRIVATE
  $<$<CXX_COMPILER_ID:AppleClang,Clang,GNU>:-Wall;-Wextra>
)
target_link_libraries(harmonizer_web PRIVATE
  PkgConfig::PORTAUDIO
  PkgConfig::AUBIO
  rubberband_live
  Threads::Threads
)

if(APPLE)
  target_link_libraries(rubberband_live PUBLIC "-framework Accelerate")
elseif(WIN32)
  target_link_libraries(harmonizer_web PRIVATE ws2_32)
endif()

add_custom_command(TARGET harmonizer_web POST_BUILD
  COMMAND "${CMAKE_COMMAND}" -E make_directory "$<TARGET_FILE_DIR:harmonizer_web>/web"
  COMMAND "${CMAKE_COMMAND}" -E copy_if_different
          "${CMAKE_CURRENT_SOURCE_DIR}/web/index.html"
          "$<TARGET_FILE_DIR:harmonizer_web>/web/index.html"
)

install(TARGETS harmonizer_web RUNTIME DESTINATION .)
install(FILES web/index.html DESTINATION web)
install(FILES README.md LICENSE DESTINATION .)
