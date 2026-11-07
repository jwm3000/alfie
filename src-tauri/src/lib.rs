use serde::Serialize;
use std::{path::PathBuf, sync::atomic::{AtomicBool, Ordering}};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

struct CloseGuard(AtomicBool);
#[derive(Serialize)]
struct Opened { path: String, data: String, revision: String }
#[tauri::command]
async fn open_project(app: AppHandle) -> Result<Option<Opened>, String> { let Some(folder)=app.dialog().file().blocking_pick_folder() else {return Ok(None)};let path:PathBuf=folder.into_path().map_err(|e|e.to_string())?;let (data,revision)=alfie_core::open(&path).map_err(|e|e.to_string())?;Ok(Some(Opened{path:path.display().to_string(),data,revision})) }
#[tauri::command]
async fn create_project(app: AppHandle, data: String, _guard: State<'_, CloseGuard>) -> Result<Option<Opened>,String> {
    let folder=app.dialog().file().blocking_pick_folder(); let Some(folder)=folder else{return Ok(None)};let path=folder.into_path().map_err(|e|e.to_string())?;let (data,revision)=alfie_core::create(&path,&data).map_err(|e|e.to_string())?;Ok(Some(Opened{path:path.display().to_string(),data,revision}))
}
#[tauri::command]
fn save_project(path:String,data:String,expected:String)->Result<String,String>{alfie_core::save(PathBuf::from(path).as_path(),&data,&expected).map_err(|e|e.to_string())}
#[tauri::command]
fn reload_project(path:String)->Result<Opened,String>{let path=PathBuf::from(path);let (data,revision)=alfie_core::open(&path).map_err(|e|e.to_string())?;Ok(Opened{path:path.display().to_string(),data,revision})}
#[tauri::command]
fn git_action(path:String,action:String,value:String)->Result<String,String>{alfie_core::git_action(PathBuf::from(path).as_path(),&action,&value).map_err(|e|e.to_string())}
#[tauri::command]
fn fullscreen(window:tauri::WebviewWindow,enabled:bool)->Result<(),String>{window.set_fullscreen(enabled).map_err(|e|e.to_string())}
#[tauri::command]
fn set_close_guard(state:State<'_,CloseGuard>,dirty:bool){state.0.store(dirty,Ordering::Relaxed);}
#[tauri::command]
async fn check_update(app:AppHandle)->Result<serde_json::Value,String>{use tauri_plugin_updater::UpdaterExt;let updater=app.updater().map_err(|e|e.to_string())?;let update=updater.check().await.map_err(|e|e.to_string())?;Ok(match update {Some(u)=>serde_json::json!({"available":true,"version":u.version}),None=>serde_json::json!({"available":false})})}
#[tauri::command]
async fn install_update(app:AppHandle)->Result<(),String>{use tauri_plugin_updater::UpdaterExt;let update=app.updater().map_err(|e|e.to_string())?.check().await.map_err(|e|e.to_string())?;if let Some(update)=update {update.download_and_install(|_,_|{},||{}).await.map_err(|e|e.to_string())?;}Ok(())}
pub fn run(){tauri::Builder::default().plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_opener::init()).plugin(tauri_plugin_updater::Builder::new().build()).plugin(tauri_plugin_process::init()).manage(CloseGuard(AtomicBool::new(false))).invoke_handler(tauri::generate_handler![open_project,create_project,save_project,reload_project,git_action,fullscreen,set_close_guard,check_update,install_update]).run(tauri::generate_context!()).expect("Alfie could not open its window");}
