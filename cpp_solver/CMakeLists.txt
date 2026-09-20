cmake_minimum_required(VERSION 3.18)
project(beeline_cpp_solver LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(Python COMPONENTS Interpreter Development.Module REQUIRED)
find_package(pybind11 CONFIG REQUIRED)

pybind11_add_module(cpp_solver src/cpp_solver.cpp)
target_compile_features(cpp_solver PRIVATE cxx_std_20)
