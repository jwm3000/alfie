<p align="center"><img width="116" src="public/assets/icon.png" alt="Alfie app icon"></p>

<h1 align="center">Alfie</h1>
<p align="center"><em>A little room for big stories.</em></p>

Alfie is a quiet, local-first writing studio for Windows, Linux and the web. Write in independent chapters, watch your words grow, keep named versions, branch from old ideas and compare any two drafts side by side. Keep loose thoughts in a linked brainstorm, then synchronize the project to your own GitHub repository.

![Alfie writing desk](public/assets/icon.png)

### Your chapter history is a garden

Every named version becomes a labeled point on an animated branch graph. Choose any earlier point, create a new branch without losing the current draft, or compare any two versions in a familiar left and right review. Added words appear in green; removed words appear in red.

### A little comfort for a long writing day

The distraction-free, full-screen Focus mode pairs a centered manuscript with calm parchment, walnut or midnight color themes. Alfie offers optional writing sprints, thoughtful writing prompts, per-chapter notes, three original photos of Alfie from `katzen/`, and a brain-dump notebook for sparks, characters, places and questions.

### One honest, portable project

An `.alfie` file is standard, readable UTF-8 JSON with a versioned schema. It contains the book, every chapter, all labeled version parents, linked brainstorm cards and your writing goal. In the desktop app, each chapter is also written as its own Markdown file beside `.alfie`:

```text
my-story/
├── .alfie                 # complete, portable project and version history
├── .gitignore
├── chapters/
│   ├── <id>-chapter-one.md
│   └── <id>-chapter-two.md
└── .git/                  # opt in to versioned backups with your own GitHub repository
```

Alfie saves atomically and checks that the project has not changed on disk before updating it. Use the project panel to initialize Git, connect an HTTPS or SSH repository, make a clearly named commit and sync. Synchronization fast-forwards when possible and stops without discarding edits if both copies have diverged. Your writing remains local; Alfie has no account, tracking, or default cloud service.

### Download

- **Windows:** [Alfie installer (.exe)](https://github.com/jwm3000/alfie/releases/latest) — download `Alfie_…_x64-setup.exe` and run it. Alfie updates itself from new GitHub releases.
- **Linux:** AppImage, `.deb` and `.rpm` on the same [releases page](https://github.com/jwm3000/alfie/releases/latest).

### Get started

The in-browser app can be run locally:

```sh
npm ci
npm run dev
```

Browser mode saves to local device storage. Export an `.alfie` backup to move a project between browsers or use the desktop project-folder controls.

For a native development build, install Rust, Node 22, the Tauri v2 prerequisites for your platform and Git, then run:

```sh
cargo install tauri-cli --version '^2' --locked
npm ci
npm run desktop
```

On Linux, install your distribution's Tauri v2 development packages, including WebKitGTK 4.1. Production builds use `npm run desktop:build`.

### Signed GitHub updates

The GitHub Actions workflow builds Windows and Linux installers and publishes a draft release for tags named `v*`. To enable signed in-app updates, configure `plugins.updater.endpoints` and `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, then add the signing key and its password as `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets. Keep the signing private key outside the repository. Configure a real GitHub repository before triggering a release. The workflow validates these settings before it uploads a build.

### Keyboard companions

| Key | Action |
| --- | --- |
| `Ctrl` / `⌘` + `S` | Save the current project |
| `Ctrl` / `⌘` + `Shift` + `S` | Name and keep a chapter version |
| `F11` | Enter or leave full-screen Focus mode |
| `Esc` | Leave Focus mode or close a dialog |
| `Ctrl` / `⌘` + `Z` | Undo text edits |
| `Ctrl` / `⌘` + `Shift` + `Z` | Redo text edits |

Made with love for Neha, by Norbert — and supervised by Alfie.

### License

MIT. See [LICENSE](LICENSE).
