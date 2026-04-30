import pyautogui
import time

print("Move your mouse to the TOP-LEFT corner of the chat area and press Enter")
input()
top_left = pyautogui.position()
print(f"Top-left: {top_left}")

print("Move your mouse to the BOTTOM-RIGHT corner of the chat area and press Enter")
input()
bottom_right = pyautogui.position()
print(f"Bottom-right: {bottom_right}")

# Calculate region
x = top_left[0]
y = top_left[1]
width = bottom_right[0] - top_left[0]
height = bottom_right[1] - top_left[1]

print(f"Chat region: ({x}, {y}, {width}, {height})")
print("Update CHAT_REGION in ocr_capture.py with these values")