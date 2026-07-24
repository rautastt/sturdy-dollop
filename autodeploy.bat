@echo off
REM autodeploy.bat — automated deploy + run helper for REBLOX (Windows)
REM Usage:
REM   autodeploy.bat            -> runs with defaults, prompts before destructive actions
REM   autodeploy.bat --yes      -> run non-interactive, create/overwrite .env automatically
REM   autodeploy.bat --no-docker-> don't start Postgres Docker container
REM Environment overrides: you may set POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, PORT, NODE_ENV before running.

setlocal EnableDelayedExpansion

:: -------------------
:: Configuration (change these defaults or set environment variables before running)
:: -------------------
if "%POSTGRES_USER%"=="" set POSTGRES_USER=sigma
if "%POSTGRES_PASSWORD%"=="" set POSTGRES_PASSWORD=secret
if "%POSTGRES_DB%"=="" set POSTGRES_DB=sigmadb
if "%POSTGRES_CONTAINER_NAME%"=="" set POSTGRES_CONTAINER_NAME=sigma-pg
if "%POSTGRES_IMAGE%"=="" set POSTGRES_IMAGE=postgres:18
if "%PORT%"=="" set PORT=3000
if "%NODE_ENV%"=="" set NODE_ENV=development
if "%USE_DOCKER%"=="" set USE_DOCKER=1
if "%AUTO_YES%"=="" set AUTO_YES=0

:: Parse args
for %%A in (%*) do (
  if "%%~A"=="--yes" set AUTO_YES=1
  if "%%~A"=="--no-docker" set USE_DOCKER=0
)

echo [REBLOX autodeploy]
echo Using settings:
echo  POSTGRES_USER=%POSTGRES_USER%
echo  POSTGRES_PASSWORD=%POSTGRES_PASSWORD%
echo  POSTGRES_DB=%POSTGRES_DB%
echo  POSTGRES_CONTAINER_NAME=%POSTGRES_CONTAINER_NAME%
echo  POSTGRES_IMAGE=%POSTGRES_IMAGE%
echo  PORT=%PORT%
echo  NODE_ENV=%NODE_ENV%
echo  USE_DOCKER=%USE_DOCKER%

:: Ensure we're running from the repo root (where this script lives)
pushd %~dp0

:: 1) Optionally start Postgres Docker container
if "%USE_DOCKER%"=="1" (
  where docker >nul 2>&1
  if errorlevel 1 (
    echo Docker not found in PATH. Skipping Docker start. If you want Postgres via Docker, please install Docker Desktop and re-run.
  ) else (
    echo Checking for existing Postgres container named %POSTGRES_CONTAINER_NAME%...
    docker ps -a --filter "name=%POSTGRES_CONTAINER_NAME%" --format "{{.Names}}" | findstr /I "%POSTGRES_CONTAINER_NAME%" >nul 2>&1
    if errorlevel 1 (
      echo Starting Postgres container (%POSTGRES_IMAGE%)...
      docker run --name %POSTGRES_CONTAINER_NAME% -e POSTGRES_USER=%POSTGRES_USER% -e POSTGRES_PASSWORD=%POSTGRES_PASSWORD% -e POSTGRES_DB=%POSTGRES_DB% -p 5432:5432 -d %POSTGRES_IMAGE%
      if errorlevel 1 (
        echo Failed to start Docker container. Please check Docker logs.
      ) else (
        echo Postgres container started.
      )
    ) else (
      echo Container already exists. Starting it if it's stopped...
      docker start %POSTGRES_CONTAINER_NAME% >nul 2>&1 || echo Could not start existing container (maybe already running).
    )
  )
) else (
  echo Skipping Docker/Postgres startup.
)

:: Build DATABASE_URL from values (assumes Postgres on localhost:5432)
set "DATABASE_URL=postgresql://%POSTGRES_USER%:%POSTGRES_PASSWORD%@localhost:5432/%POSTGRES_DB%"

:: 2) Create .env if missing (or overwrite if --yes)
if exist .env (
  if "%AUTO_YES%"=="1" (
    echo Overwriting existing .env (AUTO_YES=1)...
    del .env
  ) else (
    echo .env already exists. Press Y to overwrite, N to keep existing .env.
    set /p choice=Overwrite .env? [y/N]: 
    if /I "%choice%"=="y" del .env
  )
)

if not exist .env (
  echo Creating .env with provided settings...
  :: generate a SESSION_SECRET using PowerShell (GUID)
  for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "[System.Guid]::NewGuid().ToString('N')"`) do set SESSION_SECRET=%%S

  (echo # ─── Database ────────────────────────────────────────────────────────────────
   echo DATABASE_URL=%DATABASE_URL%
   echo.
   echo # ─── Session ─────────────────────────────────────────────────────────────────
   echo SESSION_SECRET=%SESSION_SECRET%
   echo.
   echo # ─── Server ──────────────────────────────────────────────────────────────────
   echo PORT=%PORT%
   echo NODE_ENV=%NODE_ENV%
   echo BASE_URL=http://localhost:%PORT%
   echo.
   echo # ─── Email (SMTP) ─────────────────────────────────────────────────────────────
   echo SMTP_HOST=smtp.gmail.com
   echo SMTP_PORT=587
   echo SMTP_SECURE=false
   echo SMTP_USER=your-email@gmail.com
   echo SMTP_PASS=your-app-password
   echo EMAIL_FROM=REBLOX ^<your-email@gmail.com^>
   echo EMAIL_ENABLED=false
   echo.
   echo # ─── Uploads ─────────────────────────────────────────────────────────────────
   echo UPLOAD_DIR=./public/uploads
   echo MAX_FILE_SIZE_MB=20) > .env
  echo .env created.
) else (
  echo Keeping existing .env.
)

:: 3) Install dependencies
if exist package-lock.json (
  echo Running npm ci...
  npm ci --no-audit --no-fund || (echo npm ci failed — trying npm install && npm install)
) else (
  echo Running npm install...
  npm install --no-audit --no-fund
)

:: 4) Ensure uploads dir exists
if not exist public\uploads (
  mkdir public\uploads
  echo Created public\uploads
) else echo public\uploads exists

:: 5) Run DB setup scripts (setup-db.js and seed-admin.js) if present
if exist setup-db.js (
  echo Running node setup-db.js ...
  node setup-db.js || echo setup-db.js exited with error — check output
) else (
  if exist db\schema.sql (
    echo No setup-db.js found but db\schema.sql exists. You can run: psql -d <db> -f db/schema.sql
  ) else (
    echo No DB setup scripts found.
  )
)

if exist seed-admin.js (
  echo Running node seed-admin.js ...
  node seed-admin.js || echo seed-admin.js exited with error — check output
) else echo No seed-admin.js found (skipping)

:: 6) Start the app in a new window
echo Starting REBLOX server (new window)...
start "REBLOX" cmd /k "set NODE_ENV=%NODE_ENV% && set PORT=%PORT% && node server.js"

echo ==================================================
echo Done. REBLOX should now be running. Visit http://localhost:%PORT% 
echo If you used Docker for Postgres, it may take a few seconds for Postgres to be ready; check container logs with: docker logs -f %POSTGRES_CONTAINER_NAME%
echo ==================================================

popd
endlocal
pause
