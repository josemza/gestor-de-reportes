@echo off
echo Iniciando workers...

REM Worker 1
start "worker-01" cmd /k "python -m worker.worker"

REM Esperar 2 segundos entre workers
timeout /t 2 /nobreak > nul

REM Worker 2
start "worker-02" cmd /k "python -m worker.worker"

REM Esperar 2 segundos
timeout /t 2 /nobreak > nul

REM Worker 3
start "worker-03" cmd /k "python -m worker.worker"

echo Todos los workers iniciados
pause