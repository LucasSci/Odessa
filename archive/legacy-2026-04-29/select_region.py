import json
import os
import tkinter as tk
from PIL import ImageGrab, ImageTk

REGION_FILE = "regions.json"
REGION_NAMES = ["chat_region", "gifts_region"]
NICE_NAMES = {"chat_region": "Chat", "gifts_region": "Gifts"}


def load_regions():
    if os.path.exists(REGION_FILE):
        try:
            with open(REGION_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_regions(regions):
    with open(REGION_FILE, "w", encoding="utf-8") as f:
        json.dump(regions, f, indent=2)


class RegionSelector:
    def __init__(self, root):
        self.root = root
        self.root.title("Select OBS Chat Regions")
        self.root.attributes("-fullscreen", True)
        self.root.configure(background="black")
        self.root.bind("<Escape>", lambda event: self.root.destroy())

        self.screenshot = ImageGrab.grab(all_screens=True)
        self.photo = ImageTk.PhotoImage(self.screenshot)

        self.canvas = tk.Canvas(root, width=self.photo.width(), height=self.photo.height())
        self.canvas.pack(fill=tk.BOTH, expand=True)
        self.canvas.create_image(0, 0, anchor=tk.NW, image=self.photo)

        self.start_x = None
        self.start_y = None
        self.rect = None
        self.regions = load_regions()
        self.current_index = 0
        self.current_name = REGION_NAMES[self.current_index]

        self.status_text = tk.StringVar()
        self.status_text.set(self.get_status_text())

        status_bar = tk.Label(root, textvariable=self.status_text, bg="black", fg="white", font=("Arial", 14))
        status_bar.place(relx=0.01, rely=0.01, anchor="nw")

        button_frame = tk.Frame(root, bg="black")
        button_frame.place(relx=0.99, rely=0.01, anchor="ne")

        self.next_button = tk.Button(button_frame, text="Next", command=self.next_region, state=tk.DISABLED, width=10)
        self.next_button.pack(side=tk.RIGHT, padx=4)

        cancel_button = tk.Button(button_frame, text="Cancel", command=root.destroy, width=10)
        cancel_button.pack(side=tk.RIGHT, padx=4)

        instructions = (
            "Clique e arraste para selecionar a área do chat ou gifts. "
            "Pressione ESC para cancelar."
        )
        instruction_label = tk.Label(root, text=instructions, bg="black", fg="white", font=("Arial", 12))
        instruction_label.place(relx=0.01, rely=0.06, anchor="nw")

        self.canvas.bind("<ButtonPress-1>", self.on_button_press)
        self.canvas.bind("<B1-Motion>", self.on_mouse_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_button_release)

    def get_status_text(self):
        if self.current_name in self.regions:
            return f"Região {NICE_NAMES[self.current_name]} carregada: {self.regions[self.current_name]}"
        return f"Selecione a região de {NICE_NAMES[self.current_name]} (arraste com o mouse)."

    def on_button_press(self, event):
        self.start_x = event.x
        self.start_y = event.y
        if self.rect:
            self.canvas.delete(self.rect)
            self.rect = None

    def on_mouse_drag(self, event):
        if self.start_x is None or self.start_y is None:
            return
        if self.rect:
            self.canvas.delete(self.rect)
        self.rect = self.canvas.create_rectangle(
            self.start_x,
            self.start_y,
            event.x,
            event.y,
            outline="red",
            width=2,
        )

    def on_button_release(self, event):
        if self.start_x is None or self.start_y is None:
            return
        x1 = min(self.start_x, event.x)
        y1 = min(self.start_y, event.y)
        x2 = max(self.start_x, event.x)
        y2 = max(self.start_y, event.y)
        width = x2 - x1
        height = y2 - y1
        if width < 10 or height < 10:
            self.status_text.set("Seleção muito pequena. Arraste novamente.")
            return
        self.regions[self.current_name] = [x1, y1, width, height]
        self.status_text.set(f"Selecionado {NICE_NAMES[self.current_name]}: {self.regions[self.current_name]}.")
        self.next_button.config(state=tk.NORMAL)

    def next_region(self):
        save_regions(self.regions)
        self.current_index += 1
        if self.current_index >= len(REGION_NAMES):
            self.status_text.set("Regiões salvas em regions.json. Feche esta janela.")
            self.next_button.config(state=tk.DISABLED)
            self.root.after(1500, self.root.destroy)
            return
        self.current_name = REGION_NAMES[self.current_index]
        self.status_text.set(self.get_status_text())
        self.next_button.config(state=tk.DISABLED)
        if self.rect:
            self.canvas.delete(self.rect)
            self.rect = None
        self.start_x = None
        self.start_y = None


def main():
    root = tk.Tk()
    RegionSelector(root)
    root.mainloop()


if __name__ == "__main__":
    main()
