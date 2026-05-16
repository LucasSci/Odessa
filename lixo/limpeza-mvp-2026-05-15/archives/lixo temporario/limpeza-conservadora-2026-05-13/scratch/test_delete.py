import os
from pathlib import Path

video_path = Path(r"c:\Users\Lucas\Desktop\Odessa\assets\videos\video_04.mp4")
if not video_path.exists():
    # Try another one from the list
    video_path = Path(r"c:\Users\Lucas\Desktop\Odessa\assets\videos\Grok-Video-73E0875D-F218-4712-8B43-F38D0E1459E78.mp4")

print(f"Checking {video_path}")
if video_path.exists():
    try:
        os.remove(video_path)
        print("Success")
    except Exception as e:
        print(f"Error: {e}")
else:
    print("Not found")
