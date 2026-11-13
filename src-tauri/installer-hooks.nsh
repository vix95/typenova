; Extra steps of the Windows (NSIS) installer, hooked in by `bundle.windows.nsis.installerHooks` of tauri.conf.json.

; The standard uninstaller gives the file types back to the program that had them but leaves the "<class>_backup" values it wrote in the extension keys, and
; the key of an extension that did not exist before (.mmd, .mermaid...) stays as an empty shell. This removes both, for the file classes TypeNova registers
; ("Markdown document" and "Mermaid diagram"); values written by other programs are left alone.
!macro TypeNovaCleanExtension EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}" "Markdown document_backup"
  DeleteRegValue SHCTX "Software\Classes\.${EXT}" "Mermaid diagram_backup"
  ReadRegStr $R0 SHCTX "Software\Classes\.${EXT}" ""
  ${If} $R0 == ""
    DeleteRegValue SHCTX "Software\Classes\.${EXT}" ""
    DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}"
  ${EndIf}
!macroend

; Uninstalling TypeNova leaves nothing of its own behind. The standard uninstaller removes the application data (settings, the link index, the WebView profile) only when
; a box in its window is ticked, and a silent uninstall never ticks it; here the data is removed in every real uninstall. An update (the new installer runs the old
; uninstaller with /UPDATE) keeps it. The user's own files (notes, projects, typenova.config.json in a project folder) are never touched.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    SetShellVarContext current
    ; The data folders hold thousands of small WebView files. `RmDir /r` of NSIS logs every one of them in the window and is slow; `rd /s /q` removes them without
    ; any output (nsExec keeps the console window hidden) and the uninstaller still waits for it, so nothing is left behind when it ends.
    SetDetailsPrint none
    nsExec::Exec '"$SYSDIR\cmd.exe" /c rd /s /q "$LOCALAPPDATA\${BUNDLEID}"'
    Pop $R1
    nsExec::Exec '"$SYSDIR\cmd.exe" /c rd /s /q "$APPDATA\${BUNDLEID}"'
    Pop $R1
    SetDetailsPrint both
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"
    DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
    DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"
    !insertmacro TypeNovaCleanExtension "md"
    !insertmacro TypeNovaCleanExtension "markdown"
    !insertmacro TypeNovaCleanExtension "mdown"
    !insertmacro TypeNovaCleanExtension "mkd"
    !insertmacro TypeNovaCleanExtension "mdx"
    !insertmacro TypeNovaCleanExtension "rmd"
    !insertmacro TypeNovaCleanExtension "qmd"
    !insertmacro TypeNovaCleanExtension "mdc"
    !insertmacro TypeNovaCleanExtension "mmd"
    !insertmacro TypeNovaCleanExtension "mermaid"
  ${EndIf}
!macroend
