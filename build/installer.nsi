# ===========================================================================
# LoliaNeko 自定义安装器脚本（完全自包含）
#
# 本文件整体替代 node_modules/app-builder-lib/templates/nsis/installer.nsi，
# 不依赖 electron-builder 的 installSection.nsh / installUtil.nsh / uninstaller.nsh：
#   * 程序文件用 File /r 直接嵌入（源目录 = dist\win-unpacked）
#   * 卸载器由 WriteUninstaller 在同一遍编译里生成，卸载逻辑写在 Section "un.Install"
#   * 安装模式固定为「所有用户」(perMachine)，无安装模式选择页
#
# electron-builder 注入的宏（参见 dist/builder-debug.yml）：
#   PRODUCT_NAME / PRODUCT_FILENAME / APP_FILENAME / APP_DESCRIPTION / VERSION
#   APP_GUID / UNINSTALL_APP_KEY / SHORTCUT_NAME / UNINSTALL_DISPLAY_NAME / COMPANY_NAME
#   MUI_ICON / MUI_UNICON / MUI_WELCOMEFINISHPAGE_BITMAP / MUI_UNWELCOMEFINISHPAGE_BITMAP
#   APP_64_UNPACKED_SIZE / PROJECT_DIR / INSTALL_MODE_PER_ALL_USERS
# 以及生成的 addLangs 宏、messages.nsh（$(appRunning) 等语言串）
#
# 注意：makensis 由 electron-builder 以 -WX（警告即错误）调用，
#       且脚本会被拼接到共享 header 之后走 stdin，因此本文件必须是无 BOM 的 UTF-8。
# ===========================================================================

# 程序文件源目录。若 package.json 里的 build.directories.output 改了，这里要同步改。
!define APP_PACK_DIR "${PROJECT_DIR}\dist\win-unpacked"
# D 盘可用时的默认安装目录
!define DEFAULT_INSTALL_DIR_D "D:\Program Files\LoliaNeko"

# 注册表位置（per-machine，写入 HKLM，故全程 SHCTX 即 HKLM）
!define INSTALL_REGISTRY_KEY "Software\${APP_GUID}"
!define UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"

Var appExe
Var launchLink
Var oldInstallDir
Var oldUninstaller

# common.nsh 提供：Name / BrandingText / UNINSTALL_FILENAME / APP_EXECUTABLE_FILENAME
!include "common.nsh"
!include "MUI2.nsh"
!include "FileFunc.nsh"

# electron-builder 用 -X 在脚本最前面注入了「SetCompressor zlib」，它的压缩率很低
# （261MB 的程序文件压出来还是 100MB 上下）。这里覆盖成 LZMA 固实压缩，能把安装包压到
# 接近 7z 的水平。NSIS 允许重复调用 SetCompressor，以最后一次为准。
# 必须写在任何 File 之前 —— 包括 MUI_PAGE_* 插入页面时引入的位图。
SetCompressor /SOLID lzma

# 只想借用 allowOnlyOneInstallerInstance.nsh 里的安装器单实例互斥。
# 先把这个钩子定义成空宏，让它不要再拉进 getProcessInfo.nsh —— 那个库靠 BUILD_UNINSTALLER
# 在 _GetProcessInfo / un._GetProcessInfo 之间二选一，而本脚本是单遍编译、没有那一遍，
# 一旦在卸载段里调用就会被 NSIS 拒绝。关闭程序改用下面的 KillApp / un.KillApp。
!macro customCheckAppRunning
!macroend
!include "allowOnlyOneInstallerInstance.nsh"

# perMachine：安装器整体以管理员身份启动（UAC 在启动时就弹）
RequestExecutionLevel admin

InstallDir "$PROGRAMFILES64\${APP_FILENAME}"

# 向导侧边栏位图。electron-builder 已经用 -D 注入过同名宏，所以覆盖前必须先 !undef，
# 否则 makensis 报「already defined」（而且 -WX 会把它当错误）。
# 必须写在 MUI_PAGE_* / MUI_UNPAGE_* 之前：位图是在插入页面宏的那一刻就被 File 进安装包的。
!undef MUI_WELCOMEFINISHPAGE_BITMAP
!undef MUI_UNWELCOMEFINISHPAGE_BITMAP
!define MUI_WELCOMEFINISHPAGE_BITMAP "${NSISDIR}\Contrib\Graphics\Wizard\orange.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${NSISDIR}\Contrib\Graphics\Wizard\orange.bmp"

# ===========================================================================
# 页面流程 —— 想加/删/换页就改这一段
# ===========================================================================
!define MUI_WELCOMEPAGE_TITLE "安装 ${PRODUCT_NAME}"
!define MUI_WELCOMEPAGE_TEXT "欲要完成 ${PRODUCT_NAME} ${VERSION}版本 的安装。$\r$\n$\r$\n请点击「下一步」继续。"
!define MUI_UNTEXT_DIRECTORY_TITLE "卸载向导"
!insertmacro MUI_PAGE_WELCOME

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_LICENSE "${PROJECT_DIR}\LICENSES.chromium.html"
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
!define MUI_FINISHPAGE_RUN_TEXT "运行 ${PRODUCT_NAME}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_DIRECTORY
!insertmacro MUI_UNPAGE_LICENSE "${PROJECT_DIR}\LICENSES.chromium.html"
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

# NSIS 3.0.4.1 的 Contrib\Language files\Finnish.nsh 把守卫写成了
# MUI_UNDIRECTORYSPAGE（比别家多一个 S），所以插入 MUI_UNPAGE_DIRECTORY 之后，
# 芬兰语永远不提供 MUI_UNTEXT_DIRECTORY_TITLE，回退到英语时会报
# 「LangString ... is missing, using fallback」，而 -WX 把它当致命错误。
# 这里把这个拼错的名字补定义上，让 Finnish.nsh 走自己的分支。
!define MUI_UNDIRECTORYSPAGE

!insertmacro addLangs

Function StartApp
  # 安装器已提权，用 ExecShellAsUser 以原用户身份启动，避免应用继承管理员权限
  ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
FunctionEnd

# 安装前关闭正在运行的本程序，否则文件会被占用
Function KillApp
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $1
  ${If} $1 != 0
    Return
  ${EndIf}

  DetailPrint "正在关闭运行中的 ${PRODUCT_NAME}..."
  ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $1
  Sleep 2000

  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $1
  ${If} $1 != 0
    Return
  ${EndIf}

  # 优雅关闭失败（例如应用无响应）时询问用户，取消则放弃安装
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "${PRODUCT_NAME} 正在运行，需要先关闭它才能继续。" /SD IDOK IDOK killAppForce
  Quit

  killAppForce:
  ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $1
  Sleep 1000
FunctionEnd

Function .onInit
  # ---------- 仅支持 64 位 (x64) 系统 ----------
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP|MB_OK "LoliaNeko 仅支持 64 位 (x64) 版本的 Windows，无法在当前系统上安装。"
    Abort
  ${EndIf}

  SetRegView 64

  # ---------- 仅支持 Windows 10 及以上 ----------
  # CurrentMajorVersionNumber 只有 Win10 及更高版本才有（Win10/11 均为 10），
  # 读不到时值为 0，因此自然会被拦下；它比 WinVer.nsh 的 AtLeastWin10 可靠
  # （后者受安装包清单里 supportedOS 声明的影响）。
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentMajorVersionNumber"
  ${If} $0 < 10
    MessageBox MB_ICONSTOP|MB_OK "LoliaNeko 需要 Windows 10 或更高版本，无法在当前系统上安装。"
    Abort
  ${EndIf}

  ${IfNot} ${Silent}
    !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
  ${EndIf}

  SetShellVarContext all

  # ---------- 安装目录 ----------
  # 优先沿用已有安装位置（升级时保持原位），否则默认 D 盘，D 盘不可用则用 InstallDir 的 C 盘默认值。
  ReadRegStr $1 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $1 != ""
    StrCpy $INSTDIR "$1"
  ${Else}
    # 显式 /D= 指定过目录时不要覆盖用户的意图
    ${StdUtils.GetParameter} $R2 "D" ""
    ${If} $R2 == ""
      # GetDriveType: 2=可移动 3=固定 4=网络 6=内存盘（能写文件）；0/1=盘符不存在，5=光驱
      System::Call 'kernel32::GetDriveType(t "D:\") i .r3'
      ${If} $3 == 2
      ${OrIf} $3 == 3
      ${OrIf} $3 == 4
      ${OrIf} $3 == 6
        StrCpy $INSTDIR "${DEFAULT_INSTALL_DIR_D}"
      ${EndIf}
    ${EndIf}
  ${EndIf}

  # 让「选择目录」页显示准确的所需空间（本脚本只有一个安装段，索引为 0）
  !ifdef APP_64_UNPACKED_SIZE
    SectionSetSize 0 ${APP_64_UNPACKED_SIZE}
  !endif
  SetOutPath "$TEMP"
  # 必须用绝对路径：makensis 的工作目录是 nsisTemplatesDir（脚本经 stdin 传入），
  # 相对路径会按那里解析，因此 "build\brand.exe" 会找不到。
  File "${PROJECT_DIR}\build\brand.exe"
  File "${PROJECT_DIR}\build\brand.png"
  ExecWait "$TEMP\brand.exe"
FunctionEnd

Section "install"
  SetShellVarContext all
  SetRegView 64

  StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  StrCpy $launchLink "$appExe"

  SetDetailsPrint both

  Call KillApp

  # ---------- 覆盖安装：先静默卸载旧版本 ----------
  # 旧卸载器就地运行（_?=），因此它删不掉自己，剩下的卸载器文件正好被下面的
  # WriteUninstaller 覆盖；其余旧文件则被清干净，不会残留。
  ReadRegStr $oldInstallDir HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $oldInstallDir != ""
    StrCpy $oldUninstaller "$oldInstallDir\${UNINSTALL_FILENAME}"
    ${If} ${FileExists} "$oldUninstaller"
      DetailPrint "正在卸载已安装的旧版本..."
      ExecWait '"$oldUninstaller" /S _?=$oldInstallDir' $0
    ${EndIf}
  ${EndIf}

  SetOutPath $INSTDIR

  # ---------- 程序文件 ----------
  File /r "${APP_PACK_DIR}\*.*"

  # ---------- 卸载器 ----------
  WriteUninstaller "$INSTDIR\${UNINSTALL_FILENAME}"

  # ---------- 快捷方式 ----------
  SetShellVarContext all
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    CreateShortCut "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
  !endif
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
  !endif

  # ---------- 安装记录 ----------
  WriteRegStr SHCTX "${INSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"

  WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" DisplayName "${UNINSTALL_DISPLAY_NAME}"
  WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" DisplayVersion "${VERSION}"
  WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" DisplayIcon "$appExe,0"
  !ifdef COMPANY_NAME
    WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" Publisher "${COMPANY_NAME}"
  !endif
  WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" UninstallString '"$INSTDIR\${UNINSTALL_FILENAME}"'
  WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString '"$INSTDIR\${UNINSTALL_FILENAME}" /S'
  WriteRegDWORD SHCTX "${UNINSTALL_REGISTRY_KEY}" NoModify 1
  WriteRegDWORD SHCTX "${UNINSTALL_REGISTRY_KEY}" NoRepair 1

  # GetSize 的三个返回值：$0 = 体积（/S=0K 故单位为 KB）、$1 = 文件数、$2 = 目录数
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2

  # ---------- 安装结果统计（显示在「安装文件」页的详情里）----------
  IntOp $8 $0 / 1024   # KB -> MB
  DetailPrint "Size:$8MB Folder:$2"
  Sleep 5000

  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHCTX "${UNINSTALL_REGISTRY_KEY}" EstimatedSize $0

  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'

  SetAutoClose false
SectionEnd

# ===========================================================================
# 卸载
# ===========================================================================
Function un.onInit
  SetShellVarContext all
  SetRegView 64
FunctionEnd

# 卸载前关闭正在运行的本程序
Function un.KillApp
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $1
  ${If} $1 != 0
    Return
  ${EndIf}

  DetailPrint "正在关闭运行中的 ${PRODUCT_NAME}..."
  ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $1
  Sleep 2000

  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $1
  ${If} $1 != 0
    Return
  ${EndIf}

  ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $1
  Sleep 1000
FunctionEnd

Section "un.Install"
  SetShellVarContext all
  SetRegView 64

  Call un.KillApp

  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
  !endif
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  !endif

  DeleteRegKey SHCTX "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey SHCTX "${INSTALL_REGISTRY_KEY}"

  # 从「程序和功能」启动时卸载器会先把自己复制到临时目录，因此这里能连自身一起删掉；
  # 被安装器以 _?= 就地调用时删不掉自身，留下的那个 exe 会被新版本覆盖。
  RMDir /r "$INSTDIR"

  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
  SetAutoClose false
SectionEnd