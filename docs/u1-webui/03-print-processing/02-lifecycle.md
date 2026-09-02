# Print popup: dialog lifecycle

The popup is modal, but it does **not** close itself from a button. The page ends
the dialog by calling bridge commands, and the host translates those into
`EndModal`. Getting this sequence wrong is what the `SafeEndModal` guard exists
to survive.

## The close protocol

Two commands, in order, with distinct jobs:

```
1. sw_SetFilamentMappingComplete { status: "success" | "canceled" | <other> }
      -> records the outcome on the dialog     (dialog->set_finish(true|false))
      -> does NOT close the dialog

2. sw_FinishFilamentMapping     {}
      -> reads the recorded outcome and closes
         dialog->SafeEndModal(is_finish() ? wxID_OK : wxID_CANCEL)
```

Splitting "decide" from "close" is deliberate. From `WebPreprintDialog.cpp`:

```cpp
void WebPreprintDialog::set_finish(bool flag)
{
    m_finish = flag;
    // BBS: Don't call EndModal here to avoid conflict with sw_FinishFilamentMapping()
    // The external sw_FinishFilamentMapping() function will handle EndModal based on m_finish flag
}
```

`SafeEndModal` then makes the close idempotent, because the page, the window
manager and the `wxEVT_CLOSE_WINDOW` handler can all race to end the same dialog:

```cpp
void WebPreprintDialog::SafeEndModal(int returnCode)
{
    // BBS: Prevent duplicate EndModal calls which can cause crashes
    if (IsModal() && !m_modal_ended) {
        m_modal_ended = true;
        EndModal(returnCode);
    }
}
```

Any `status` other than `"success"` or `"canceled"` is treated as an error and
raises a native `MessageDialog` ("setting failed") rather than closing.

## `sw_FinishPreprint` — the outcome report

Separate from closing, the page reports how the preprint went:

```cpp
if (m_param_data.count("status")) {
    std::string status = m_param_data["status"].get<std::string>();
    auto p_dialog = dynamic_cast<WebPreprintDialog*>(wxGetApp().get_web_preprint_dialog());
    if (p_dialog && status != "success")
        p_dialog->set_swtich_to_device(false);   // don't jump to the Device tab on failure
}
```

That flag is the only thing controlling whether Orca switches tabs afterwards.

## Full sequence

```
Plater: user picks "Send to printer"
  └─ PrintHostSendDialog                    (native; filename, post-action, storage)
       └─ WebPreprintDialog::run()
            ├─ SSWCP::update_active_filename(gcode path)
            ├─ SSWCP::update_display_filename(upload path)
            ├─ LoadURL(path=4 | path=5)
            └─ ShowModal()
                 │
                 │   page boots, then over the WCP bridge:
                 ├── sw_GetActiveFile          -> which file
                 ├── sw_GetPrintLegal          -> preset vs connected model
                 ├── sw_GetFileFilamentMapping -> filament requirements
                 ├── sw_GetPrintZip            -> zip built on a worker thread
                 ├── sw_UpdateMachineFilamentInfo
                 ├── sw_StartLocalPrint | sw_StartCloudPrint
                 ├── sw_FinishPreprint  { status }
                 ├── sw_SetFilamentMappingComplete { status }   -> set_finish()
                 └── sw_FinishFilamentMapping                   -> SafeEndModal()
                 │
            ShowModal returns
            └─ if (dialog->is_finish()) select_tab(tpMonitor)
```

## Return-value quirk

`run()` does not return what `ShowModal` returned:

```cpp
int result = this->ShowModal();
if (result == wxID_OK || (result == wxID_CANCEL && m_finish))
    return m_finish;
return false;
```

`wxID_CANCEL` combined with `m_finish == true` is treated as success — that is the
path taken when the window is closed by `OnClose` after the page has already
recorded a successful mapping. The caller in `Plater.cpp` ignores the return value
anyway and re-reads `dialog->is_finish()` directly.

## Threading

`sw_GetPrintZip` is the one handler that leaves the UI thread:

```cpp
m_work_thread = std::thread([oriname, targetname, weak_self]() {
    std::string zipname = generate_zip_path(oriname, targetname);
    json res = get_or_create_zip_json(oriname, targetname, zipname);
    wxGetApp().CallAfter([weak_self, res]() { ... send_to_js(); finish_job(); });
});
```

It joins any previous worker before starting a new one, and marshals the reply
back through `CallAfter`. Every other handler on this surface is synchronous on
the UI thread.

## Cleanup

`WebPreprintDialog`'s constructor deletes any existing *device* dialog first, and
registers itself as the app's current preprint dialog; the destructor unregisters
it and detaches the webview from the bridge:

```cpp
WebPreprintDialog::~WebPreprintDialog()
{
    SSWCP::on_webview_delete(m_browser);        // drop subscriptions bound to this view
    wxGetApp().fltviews().remove_view(m_browser);
    wxGetApp().set_web_preprint_dialog(nullptr);
}
```

`OnClose` additionally dismisses any in-flight `PrintHostUpload` notification
before ending the modal.
