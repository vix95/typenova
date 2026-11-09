# Spell checking dictionaries

Hunspell dictionaries (`index.aff` and `index.dic`) that the spell checker of the program (`src/spell.rs`) reads. They are
built into the program and are used as they are, without changes. They are data files and keep their own licenses; the
license texts that came with them are in each folder (`license`, `readme.md`).

| Folder | Language | Source | License |
|---|---|---|---|
| `pl` | Polish | npm package [`dictionary-pl`](https://github.com/wooorm/dictionaries/tree/main/dictionaries/pl) 2.0.0, made from the OpenOffice.org Polish dictionary of the Polish Native Lang Project (maintainer Marek Futrega, corrections Marcin Miłkowski) | GPL, LGPL, MPL and Creative Commons ShareAlike (the package declares `GPL-3.0 OR LGPL-3.0 OR MPL-2.0`). TypeNova uses it under the Mozilla Public License; the files stay under that license. |
| `en` | English (US) | npm package [`dictionary-en`](https://github.com/wooorm/dictionaries/tree/main/dictionaries/en) 4.0.0, made from SCOWL / the Hunspell `en_US` dictionary | MIT and BSD (see `en/license`) |

The words are checked and suggestions are made with the Rust crate [`spellbook`](https://crates.io/crates/spellbook) (MIT),
which reads the Hunspell format.

## Updating a dictionary

Install the newer npm package in an empty folder, copy its `index.aff`, `index.dic`, `license` and `readme.md` over the
files here, and run `cargo test spell` in `src-tauri`. The files must stay byte-exact: `.gitattributes` turns line-ending
conversion off for this folder.
