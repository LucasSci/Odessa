import zipfile
import xml.etree.ElementTree as ET
import os

def docx_to_text(path):
    document = zipfile.ZipFile(path)
    xml_content = document.read('word/document.xml')
    document.close()

    tree = ET.fromstring(xml_content)

    # Namespaces
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

    paragraphs = []
    for paragraph in tree.findall('.//w:p', ns):
        texts = [node.text for node in paragraph.findall('.//w:t', ns) if node.text]
        if texts:
            paragraphs.append("".join(texts))

    return "\n".join(paragraphs)

file_path = r"C:\Users\Lucas\Downloads\Plano_Completo_Melhorias_Odessa.docx"
output_path = r"c:\Users\Lucas\Desktop\Odessa\scratch\plano_odessa_utf8.txt"
try:
    text = docx_to_text(file_path)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"Success: Content saved to {output_path}")
except Exception as e:
    print(f"Error: {e}")
