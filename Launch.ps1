param(
    [ValidateSet('install', 'uninstall')]
    [string]$Action = 'install',
    [string]$DshHome = ''
)
$ErrorActionPreference = 'Stop'
try {
    if (-not $DshHome) {
        $DshHome = $env:DSH_HOME
    }
    if (-not $DshHome) {
        $DshHome = [Environment]::GetEnvironmentVariable('DSH_HOME', 'User')
    }
    if (-not $DshHome) {
        $DshHome = Join-Path $env:USERPROFILE '.dsh'
    }
    $DshHome = [IO.Path]::GetFullPath($DshHome)
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) {
        $nodePath = $nodeCommand.Source
    } else {
        $nodePath = Join-Path $DshHome 'dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe'
    }
    if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
        throw 'Node.js was not found. Install the DeepSeek Harness primary runtime first.'
    }
    $arguments = @((Join-Path $PSScriptRoot 'install.mjs'), '--home', $DshHome)
    if ($Action -eq 'uninstall') {
        $arguments += '--uninstall'
    }
    & $nodePath @arguments
    exit $LASTEXITCODE
} catch {
    Write-Error $_
    exit 1
}
