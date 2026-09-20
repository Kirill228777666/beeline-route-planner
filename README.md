requirements: Python 3.12+, Node.js 18+, npm, g++ с поддержкой C++20 и DLL runtime MSYS2 в `PATH`/DLL search path.

```powershell
cd outputs/clean_project
.\build.ps1
```


## Запуск

```powershell
.\start.ps1
```


## Проверки

```powershell
.\.venv\Scripts\python.exe -m pytest -q backend\tests cpp_solver\tests
.\.venv\Scripts\python.exe scripts\full_flow.py
```
