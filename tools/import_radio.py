"""Import local MP3s into an unpacked game before playing or repackaging."""
import argparse
import json
import shutil
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("music_directory", type=Path)
parser.add_argument("game_directory", type=Path)
args = parser.parse_args()
catalog = args.game_directory / "js" / "radio-library.js"
destination = args.game_directory / "audio" / "radio"
if not catalog.is_file() or not (destination / "Moonbay FM.mp3").is_file():
    parser.error("请选择公开版的 web 或 resources/app/game 目录")
if not args.music_directory.is_dir():
    parser.error("找不到音乐目录")
tracks = sorted(p for p in args.music_directory.iterdir() if p.is_file() and p.suffix.lower() == ".mp3")
if not tracks:
    parser.error("目录里没有 MP3")
if any(p.stem.casefold() == "moonbay fm" for p in tracks):
    parser.error("Moonbay FM 是内置电台名，请先重命名同名导入文件")
for track in tracks:
    target = destination / (track.stem + ".mp3")
    if target.resolve() != track.resolve():
        shutil.copyfile(track, target)
names = ["Moonbay FM"] + sorted(p.stem for p in destination.glob("*.mp3") if p.stem != "Moonbay FM")
temporary = catalog.with_suffix(".js.new")
temporary.write_text("window.BTAStations = " + json.dumps(names, ensure_ascii=False) + ";\n", encoding="utf8")
temporary.replace(catalog)
print(f"已安装 {len(names)} 个电台")
