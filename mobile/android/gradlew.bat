@rem Gradle wrapper script for Windows
@if "%DEBUG%" == "" @echo off
@setlocal

where gradle >nul 2>nul
if %ERRORLEVEL% equ 0 (
    gradle %*
    goto end
)

set DIRNAME=%~dp0
if "%DIRNAME%" == "" set DIRNAME=.
set APP_BASE_NAME=%~n0
set APP_HOME=%DIRNAME%

set CLASSPATH=%APP_HOME%\gradle\wrapper\gradle-wrapper.jar
if exist "%CLASSPATH%" (
    java -Xmx2048m -jar "%CLASSPATH%" %*
) else (
    echo Gradle wrapper jar not found. Please install Gradle.
)

:end
@endlocal
