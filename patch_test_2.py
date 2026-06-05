import re

with open("src/CaptureStudio.test.tsx", "r") as f:
    content = f.read()

# Mock canvas output as memory tells us
content = content.replace("configurable: true,\n      value: { getDisplayMedia },\n    });",
"""configurable: true,
      value: { getDisplayMedia },
    });

    // Memory explicitly states: "In CaptureStudio.test.tsx, testing the screen capture mode's full OCR pipeline requires explicitly injecting mock canvas image data"
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(400) }),
    }) as any;

    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,mocked_image_data_with_content');
""")

with open("src/CaptureStudio.test.tsx", "w") as f:
    f.write(content)
