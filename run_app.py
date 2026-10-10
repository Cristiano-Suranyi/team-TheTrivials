"""Start Hidden on Windows, macOS or Linux: python run_app.py.

First run installs the Python environment and builds the React frontend.
Requires Python 3.9+ and Node.js 22.12+ (npm or pnpm) for the initial build.
"""
from pathlib import Path
import argparse
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--build', action='store_true', help='Rebuild the frontend before starting')
    parser.add_argument('--setup', action='store_true', help='Install/update dependencies, build and exit')
    args = parser.parse_args()
    if sys.version_info < (3, 9):
        raise SystemExit('Python 3.9 or newer is required.')
    python = ROOT / 'submission' / 'venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    ready = python.is_file() and subprocess.run(
        [str(python), '-c', 'import fastapi, uvicorn, python_multipart, pymupdf, google.genai, presidio_analyzer, pt_core_news_lg'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if (args.setup and os.environ.get('HIDDEN_SETUP_DONE') != '1') or not ready:
        subprocess.run([sys.executable, str(ROOT / 'submission' / 'setup.py')], check=True)
    if Path(sys.prefix).resolve() != python.parent.parent.resolve():
        return subprocess.call([str(python), str(Path(__file__).resolve()), *sys.argv[1:]], cwd=ROOT,
                               env={**os.environ, 'HIDDEN_SETUP_DONE': '1'} if args.setup else None)
    frontend = ROOT / 'frontend'
    if args.build or args.setup or not (frontend / 'dist' / 'index.html').is_file():
        node = shutil.which('node')
        manager = shutil.which('pnpm') or shutil.which('npm')
        if not node or not manager:
            raise SystemExit('Install Node.js 22.12+ with npm (or pnpm), reopen the terminal and run this command again.')
        version = subprocess.check_output([node, '--version'], text=True).strip().lstrip('v')
        if tuple(int(part) for part in version.split('.')[:2]) < (22, 12):
            raise SystemExit('Use Node.js 22.12+ to build the interface.')
        print('Installing and building the frontend...', flush=True)
        install = ['install', '--frozen-lockfile'] if Path(manager).stem.startswith('pnpm') else ['install', '--no-audit', '--no-fund']
        subprocess.run([manager, *install], cwd=frontend, check=True)
        subprocess.run([manager, 'run', 'build'], cwd=frontend, check=True)
    if args.setup:
        print('Setup complete. Run: python run_app.py')
        return 0
    import uvicorn
    from submission.web_api import app
    print(f'\nHidden is starting at http://127.0.0.1:{args.port}\nPress Ctrl+C to stop.\n', flush=True)
    uvicorn.run(app, host='127.0.0.1', port=args.port, access_log=False)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(run())
    except (OSError, subprocess.CalledProcessError) as error:
        print(f'Startup failed: {error}', file=sys.stderr)
        raise SystemExit(1)
    except KeyboardInterrupt:
        raise SystemExit(130)
