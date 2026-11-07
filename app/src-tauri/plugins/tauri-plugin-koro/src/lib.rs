//! One generic command, `call`, forwards `{ cmd, args }` to the Kotlin plugin (`KoroPlugin.<cmd>`).
use serde_json::Value;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct Koro<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[tauri::command]
async fn call<R: Runtime>(app: AppHandle<R>, cmd: String, args: Option<Value>) -> Result<Value, String> {
    #[cfg(target_os = "android")]
    {
        let payload = args.unwrap_or_else(|| Value::Object(Default::default()));
        app.state::<Koro<R>>()
            .0
            .run_mobile_plugin::<Value>(&cmd, payload)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, args);
        Err(format!("koro:{cmd} is only available on Android"))
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("koro")
        .invoke_handler(tauri::generate_handler![call])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("com.koro.plugin", "KoroPlugin")?;
                _app.manage(Koro(handle));
            }
            Ok(())
        })
        .build()
}
