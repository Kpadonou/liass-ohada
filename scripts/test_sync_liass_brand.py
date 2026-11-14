import subprocess
import tempfile
import unittest
from pathlib import Path


REPOSITORY = Path(__file__).resolve().parents[1]
SYNC_SCRIPT = REPOSITORY / "scripts" / "sync_liass_brand.py"
ASSETS = {
    "logos/logo-horizontal-navy-gold.png": "assets/logos/full/logo-horizontal-navy-gold.png",
    "logos/logo-horizontal-white-gold.png": "assets/logos/full/logo-horizontal-white-gold.png",
    "logos/logo-stacked-navy-gold.png": "assets/logos/stacked/logo-stacked-navy-gold.png",
    "logos/logo-stacked-white-gold.png": "assets/logos/stacked/logo-stacked-white-gold.png",
    "logos/monogram-navy-gold.png": "assets/logos/monogram/monogram-navy-gold.png",
    "logos/monogram-white-gold.png": "assets/logos/monogram/monogram-white-gold.png",
}
REQUIRED = {
    "assets/logos/full/logo-horizontal-navy-gold.png",
    "assets/logos/full/logo-horizontal-white-gold.png",
    "assets/logos/monogram/monogram-navy-gold.png",
    "assets/logos/monogram/monogram-white-gold.png",
    "web/favicons/navy-gold/favicon.ico",
    "web/pwa/apple-touch-icon.png",
    "web/pwa/android-chrome-192x192.png",
    "web/pwa/android-chrome-512x512.png",
}


class BrandSyncTest(unittest.TestCase):
    def test_apply_and_repeat_leave_central_typescript_config_unchanged(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            repo = Path(temporary_directory)
            pack = repo / "branding" / "liass-ohada"
            frontend = repo / "packages" / "frontend"
            config = frontend / "src/app/shared/branding/liass-brand-assets.ts"
            config.parent.mkdir(parents=True)
            config.write_text(
                "export const LIASS_BRAND = { stacked: {}, socialImage: 'social.png' };\n",
                encoding="utf-8",
            )
            original_config = config.read_bytes()

            source_assets = set(ASSETS.values()) | REQUIRED
            for index, asset_path in enumerate(source_assets):
                source = pack / asset_path
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_bytes(f"asset-{index}".encode())

            command = [
                "python3",
                str(SYNC_SCRIPT),
                "--repo",
                str(repo),
                "--pack",
                "branding/liass-ohada",
                "--frontend",
                "packages/frontend",
                "--target",
                "assets",
                "--apply",
            ]
            first_run = subprocess.run(command, check=True, capture_output=True, text=True)
            second_run = subprocess.run(command, check=True, capture_output=True, text=True)

            self.assertIn("La configuration TypeScript centrale reste inchangée.", first_run.stdout)
            self.assertIn("IDENTIQUE", second_run.stdout)
            self.assertEqual(config.read_bytes(), original_config)

            for destination, source in ASSETS.items():
                copied = frontend / "src/assets/brand/liass-ohada" / destination
                self.assertEqual(
                    copied.read_bytes(),
                    (pack / source).read_bytes(),
                    msg=f"Asset was not synchronized: {destination}",
                )


if __name__ == "__main__":
    unittest.main()
