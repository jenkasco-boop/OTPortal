<#
.SYNOPSIS
  One-time IIS setup for OT Portal. Run as Administrator on the IIS server.

.PREREQUISITES
  - IIS with the WebAdministration module
  - ASP.NET Core 9 Hosting Bundle: https://dotnet.microsoft.com/download/dotnet/9.0  (run iisreset after installing)

.EXAMPLE
  # Separate site on port 8085
  .\setup-iis.ps1 -Path C:\inetpub\wwwroot\otportal -Port 8085

.EXAMPLE
  # Sub-application under Default Web Site -> http://server/otportal
  .\setup-iis.ps1 -Path C:\inetpub\wwwroot\otportal -ParentSite "Default Web Site"
#>
param(
    [Parameter(Mandatory)] [string] $Path,
    [string] $AppPool = "OTPortal",
    [string] $SiteName = "OTPortal",
    [int] $Port = 8085,
    [string] $ParentSite,             # if set, create /otportal under this site instead of a new site
    [string] $AppAlias = "otportal",
    [string] $RunnerAccount           # Windows account of the GitHub runner service, e.g. "NT AUTHORITY\NETWORK SERVICE"
)

$ErrorActionPreference = "Stop"
Import-Module WebAdministration

New-Item -ItemType Directory -Force $Path, (Join-Path $Path "App_Data") | Out-Null

if (-not (Test-Path "IIS:\AppPools\$AppPool")) {
    New-WebAppPool $AppPool | Out-Null
}
Set-ItemProperty "IIS:\AppPools\$AppPool" managedRuntimeVersion ""        # No Managed Code (ASP.NET Core)
Set-ItemProperty "IIS:\AppPools\$AppPool" startMode "AlwaysRunning"

if ($ParentSite) {
    if (-not (Get-WebApplication -Site $ParentSite -Name $AppAlias)) {
        New-WebApplication -Site $ParentSite -Name $AppAlias -PhysicalPath $Path -ApplicationPool $AppPool | Out-Null
    }
} elseif (-not (Test-Path "IIS:\Sites\$SiteName")) {
    New-Website -Name $SiteName -Port $Port -PhysicalPath $Path -ApplicationPool $AppPool | Out-Null
}

# The app pool writes the SQLite database into App_Data
icacls (Join-Path $Path "App_Data") /grant "IIS AppPool\${AppPool}:(OI)(CI)M" | Out-Null

# The GitHub runner copies files into $Path and stops/starts the app pool
if ($RunnerAccount) {
    icacls $Path /grant "${RunnerAccount}:(OI)(CI)M" | Out-Null
}

Write-Host "Done. Set repository variables: IIS_DEPLOY_PATH=$Path  IIS_APP_POOL=$AppPool"
