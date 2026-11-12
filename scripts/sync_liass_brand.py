#!/usr/bin/env python3
"""Synchronise les assets approuvés du pack Liass-OHADA avec le frontend Angular.

Exemples (depuis la racine du dépôt) :
  python3 sync_liass_brand.py                           # simulation, aucune modification
  python3 sync_liass_brand.py --apply                  # copie les fichiers
  python3 sync_liass_brand.py --target assets --apply  # force frontend/src/assets
  python3 sync_liass_brand.py --frontend apps/web --apply

Le script ne modifie ni les composants, ni index.html, ni angular.json, ni Git.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import shutil
import sys

ASSETS = {
    # Nom de destination sous brand/liass-ohada/ : chemin dans le pack ready-for-dev
    "logos/logo-horizontal-navy-gold.png": "assets/logos/full/logo-horizontal-navy-gold.png",
    "logos/logo-horizontal-white-gold.png": "assets/logos/full/logo-horizontal-white-gold.png",
    "logos/logo-stacked-navy-gold.png": "assets/logos/stacked/logo-stacked-navy-gold.png",
    "logos/logo-stacked-white-gold.png": "assets/logos/stacked/logo-stacked-white-gold.png",
    "logos/monogram-navy-gold.png": "assets/logos/monogram/monogram-navy-gold.png",
    "logos/monogram-white-gold.png": "assets/logos/monogram/monogram-white-gold.png",
    "logos/wordmark-navy-gold.png": "assets/logos/wordmark/wordmark-navy-gold.png",
    "logos/wordmark-white-gold.png": "assets/logos/wordmark/wordmark-white-gold.png",
    "icons/favicon.ico": "web/favicons/navy-gold/favicon.ico",
    "icons/favicon-16x16.png": "web/favicons/navy-gold/favicon-16x16.png",
    "icons/favicon-32x32.png": "web/favicons/navy-gold/favicon-32x32.png",
    "icons/favicon-48x48.png": "web/favicons/navy-gold/favicon-48x48.png",
    "icons/apple-touch-icon.png": "web/pwa/apple-touch-icon.png",
    "icons/android-chrome-192x192.png": "web/pwa/android-chrome-192x192.png",
    "icons/android-chrome-512x512.png": "web/pwa/android-chrome-512x512.png",
    "icons/maskable-icon-192x192.png": "web/pwa/maskable-icon-192x192.png",
    "icons/maskable-icon-512x512.png": "web/pwa/maskable-icon-512x512.png",
    "social/og-image-light-1200x630.png": "web/social/og-image-light-1200x630.png",
    "social/og-image-dark-1200x630.png": "web/social/og-image-dark-1200x630.png",
}
REQUIRED = {
    "logos/logo-horizontal-navy-gold.png",
    "logos/logo-horizontal-white-gold.png",
    "logos/monogram-navy-gold.png",
    "logos/monogram-white-gold.png",
    "icons/favicon.ico",
    "icons/apple-touch-icon.png",
    "icons/android-chrome-192x192.png",
    "icons/android-chrome-512x512.png",
}


def digest(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def find_pack(path: Path) -> Path:
    candidates = [path, path / "Liass-OHADA_Ready-for-Dev_Pack", path / "Liass-OHADA_Ready-for-Dev_Pack".lower()]
    candidates.extend(p for p in path.iterdir() if p.is_dir()) if path.is_dir() else None
    for candidate in candidates:
        if (candidate / "assets/logos/full/logo-horizontal-navy-gold.png").is_file():
            return candidate
    raise RuntimeError(
        f"Pack dev introuvable sous {path}. Attendu : "
        "assets/logos/full/logo-horizontal-navy-gold.png"
    )


def find_frontend(repo: Path, explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit).expanduser()
        p = p if p.is_absolute() else repo / p
        if not p.is_dir():
            raise RuntimeError(f"Dossier frontend absent : {p}")
        return p.resolve()
    for sub in ("frontend", "apps/frontend", "apps/web", "web", "client"):
        p = repo / sub
        if (p / "src").is_dir():
            return p.resolve()
    raise RuntimeError("Frontend introuvable. Utilise --frontend chemin/vers/frontend")


def asset_mode(frontend: Path, repo: Path, requested: str) -> str:
    if requested != "auto":
        return requested
    # Déterminer quel répertoire est effectivement exposé par Angular.
    sources = [frontend / "angular.json", frontend / "project.json", repo / "angular.json", repo / "project.json"]
    uses_public = False
    uses_assets = False
    for config in sources:
        if not config.is_file():
            continue
        try:
            parsed = json.loads(config.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        text = json.dumps(parsed).replace("\\\\", "/")
        uses_public |= '"input": "public"' in text or '"public"' in text
        uses_assets |= '"src/assets"' in text or '"input": "src/assets"' in text
    if uses_public and not uses_assets:
        return "public"
    if uses_assets and not uses_public:
        return "assets"
    if (frontend / "public").is_dir() and not (frontend / "src/assets").is_dir():
        return "public"
    if (frontend / "src/assets").is_dir() and not (frontend / "public").is_dir():
        return "assets"
    # Cas ambigu : s'abstenir de deviner (le fichier pourrait être inaccessible au runtime)
    raise RuntimeError(
        "Configuration des assets Angular ambiguë. Précise --target public ou --target assets "
        "après avoir vérifié angular.json / project.json."
    )


def sync_file(src: Path, dst: Path, *, apply: bool, backup_dir: Path, base: Path) -> str:
    if not src.exists():
        return "ABSENT"
    if dst.is_file() and digest(src) == digest(dst):
        return "IDENTIQUE"
    state = "REMPLACER" if dst.exists() else "AJOUTER"
    if apply:
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            backup = backup_dir / dst.relative_to(base)
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dst, backup)
        shutil.copy2(src, dst)
    return state


def manifest(base_url: str, colors: dict) -> dict:
    return {
        "name": "Liass-OHADA",
        "short_name": "Liass-OHADA",
        "description": "L’ERP pensé pour l’OHADA.",
        "display": "standalone",
        "start_url": "/",
        "scope": "/",
        "background_color": colors["navy"],
        "theme_color": colors["navy"],
        "icons": [
            {"src": f"{base_url}icons/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": f"{base_url}icons/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": f"{base_url}icons/maskable-icon-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }


def write_text(content: str, dst: Path, *, apply: bool, backup_dir: Path, base: Path) -> str:
    if dst.is_file() and dst.read_text(encoding="utf-8") == content:
        return "IDENTIQUE"
    state = "REMPLACER" if dst.exists() else "AJOUTER"
    if apply:
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            bk = backup_dir / dst.relative_to(base)
            bk.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dst, bk)
        dst.write_text(content, encoding="utf-8")
    return state


def main():
    parser = argparse.ArgumentParser(description="Synchroniser le branding Liass-OHADA vers Angular")
    parser.add_argument("--repo", default=".", help="Racine du dépôt Git (par défaut, répertoire courant)")
    parser.add_argument("--pack", default="branding/liass-ohada", help="Dossier décompressé du pack (depuis la racine)")
    parser.add_argument("--frontend", help="Chemin du frontend depuis la racine : frontend, apps/frontend, etc.")
    parser.add_argument("--target", choices=("auto", "public", "assets"), default="auto", help="Emplacement des assets Angular")
    parser.add_argument("--apply", action="store_true", help="Copier réellement (sinon simulation)")
    args = parser.parse_args()

    repo = Path(args.repo).expanduser().resolve()
    if not repo.is_dir():
        raise RuntimeError(f"Racine de projet absente : {repo}")
    pack = Path(args.pack).expanduser()
    pack = pack if pack.is_absolute() else repo / pack
    pack = find_pack(pack.resolve())
    frontend = find_frontend(repo, args.frontend)
    mode = asset_mode(frontend, repo, args.target)
    if mode == "public":
        base = frontend / "public"
        brand = base / "brand/liass-ohada"
        url = "/brand/liass-ohada/"
    else:
        base = frontend / "src/assets"
        brand = base / "brand/liass-ohada"
        url = "/assets/brand/liass-ohada/"
    # N'écrire qu'au sein du frontend choisi.
    if not brand.resolve().is_relative_to(frontend):
        raise RuntimeError("Chemin cible hors frontend : opération abandonnée")

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backups = repo / "branding/.sync-backups" / stamp
    colors = {"navy": "#0B2E63", "gold": "#E9A91B"}
    tokens_file = pack / "meta/brand-tokens.json"
    if tokens_file.exists():
        try:
            toks = json.loads(tokens_file.read_text(encoding="utf-8"))
            colors["navy"] = toks["colors"].get("navy", colors["navy"])
            colors["gold"] = toks["colors"].get("gold", colors["gold"])
        except (ValueError, KeyError, TypeError):
            pass

    missing_required = [s for d, s in ASSETS.items() if d in REQUIRED and not (pack / s).is_file()]
    if missing_required:
        raise RuntimeError("Fichiers indispensables absents :\n  " + "\n  ".join(missing_required))

    print(f"\nMode          : {'COPIE' if args.apply else 'SIMULATION'}")
    print(f"Pack          : {pack}")
    print(f"Frontend      : {frontend}")
    print(f"Cible         : {brand}")
    print(f"URL publique  : {url}\n")

    counter = {"AJOUTER": 0, "REMPLACER": 0, "IDENTIQUE": 0, "ABSENT": 0}
    for dst_rel, src_rel in ASSETS.items():
        status = sync_file(pack/src_rel, brand/dst_rel, apply=args.apply, backup_dir=backups, base=repo)
        counter[status] += 1
        if status == "ABSENT":
            print(f"  [optionnel absent] {src_rel}")
        else:
            print(f"  {status:10} {dst_rel}")

    # Le manifest embarqué dans le pack pointe ailleurs : générer une version adaptée à cette arborescence.
    manifest_json = json.dumps(manifest(url, colors), ensure_ascii=False, indent=2) + "\n"
    status = write_text(manifest_json, brand/"site.webmanifest", apply=args.apply, backup_dir=backups, base=repo)
    counter[status] += 1
    print(f"  {status:10} site.webmanifest (URLs corrigées)")

    ts = """/** Brand assets served by Angular. Generated by sync_liass_brand.py. */
export const LIASS_BRAND = {
  logo: {
    light: '""" + url + """logos/logo-horizontal-navy-gold.png',
    dark: '""" + url + """logos/logo-horizontal-white-gold.png',
  },
  monogram: {
    light: '""" + url + """logos/monogram-navy-gold.png',
    dark: '""" + url + """logos/monogram-white-gold.png',
  },
  favicon: '""" + url + """icons/favicon.ico',
  manifest: '""" + url + """site.webmanifest',
} as const;
"""
    config_dir = frontend / "src/app/shared/branding"
    status = write_text(ts, config_dir/"liass-brand-assets.ts", apply=args.apply, backup_dir=backups, base=repo)
    counter[status] += 1
    print(f"  {status:10} src/app/shared/branding/liass-brand-assets.ts")

    print("\nRésumé : " + ", ".join(f"{k.lower()}={v}" for k,v in counter.items()))
    if args.apply:
        print(f"Sauvegardes éventuelles : {backups}")
        print("\nÀ intégrer manuellement ou via Codex : balises favicon/manifest dans index.html,")
        print("références des composants Angular, et vérification des routes/tailles à l'écran.")
        print("Ce script n'altère ni angular.json, ni index.html, ni les composants, ni Git.")
    else:
        print("\nSimulation terminée : aucun fichier modifié. Ajouter --apply pour copier.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"ERREUR : {exc}", file=sys.stderr)
        sys.exit(1)
