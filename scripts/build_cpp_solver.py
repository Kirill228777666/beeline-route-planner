from pathlib import Path
import subprocess
import sys
import sysconfig

import pybind11


ROOT = Path(__file__).resolve().parents[1]
source = ROOT / "cpp_solver" / "src" / "cpp_solver.cpp"
output = ROOT / "cpp_solver" / ("cpp_solver" + sysconfig.get_config_var("EXT_SUFFIX"))
include_flags = [f"-I{sysconfig.get_path('include')}", f"-I{pybind11.get_include()}"]
library_dir = Path(sys.base_prefix) / "libs"
command = ["g++", "-O3", "-std=c++20", "-shared", "-fPIC", str(source), "-o", str(output),
           *include_flags, f"-L{library_dir}", f"-lpython{sys.version_info.major}{sys.version_info.minor}"]
print(" ".join(command), flush=True)
subprocess.run(command, check=True)
print(output, flush=True)
