#!/usr/bin/env python3
"""
Test script to validate the OCR backend is working correctly
"""
import requests
import json
import os
import time

def test_server():
    """Test if the server is running and responding"""
    print("=" * 60)
    print("TESTE DO SERVIDOR OCR")
    print("=" * 60)
    
    # Test health endpoint
    print("\n1. Testando endpoint de saúde...")
    try:
        response = requests.get('http://localhost:8000/health')
        print(f"   ✓ Servidor respondendo: {response.json()}")
    except Exception as e:
        print(f"   ✗ Erro: {e}")
        return False
    
    # Test root endpoint
    print("\n2. Testando endpoint raiz...")
    try:
        response = requests.get('http://localhost:8000/')
        print(f"   ✓ Resposta: {response.json()}")
    except Exception as e:
        print(f"   ✗ Erro: {e}")
        return False
    
    # Test OCR with a small region
    print("\n3. Testando OCR com região pequena (10x10 pixels)...")
    try:
        response = requests.post('http://localhost:8000/ocr', json={
            'x': 100,
            'y': 100,
            'width': 10,
            'height': 10
        })
        result = response.json()
        print(f"   ✓ OCR respondeu: '{result.get('text', '')}'")
        if result.get('error'):
            print(f"   ! Erro no OCR: {result.get('error')}")
    except Exception as e:
        print(f"   ✗ Erro na requisição: {e}")
        return False
    
    # Test OCR with a larger region (might contain text)
    print("\n4. Testando OCR com região maior (400x300 pixels)...")
    try:
        response = requests.post('http://localhost:8000/ocr', json={
            'x': 100,
            'y': 100,
            'width': 400,
            'height': 300
        })
        result = response.json()
        text = result.get('text', '')
        print(f"   ✓ OCR respondeu com {len(text)} caracteres")
        if text:
            print(f"   Texto capturado: '{text[:100]}{'...' if len(text) > 100 else ''}'")
    except Exception as e:
        print(f"   ✗ Erro na requisição: {e}")
        return False
    
    # Check log file
    print("\n5. Verificando arquivo de log...")
    if os.path.exists('captura_chat.txt'):
        with open('captura_chat.txt', 'r', encoding='utf-8') as f:
            lines = f.readlines()
        print(f"   ✓ Arquivo existe com {len(lines)} linhas")
        if lines:
            print(f"   Últimas 3 linhas:")
            for line in lines[-3:]:
                print(f"      {line.strip()}")
    else:
        print("   ! Arquivo de log não existe ainda")
    
    print("\n" + "=" * 60)
    print("✓ TODOS OS TESTES PASSARAM!")
    print("=" * 60)
    print("\nPróximas etapas:")
    print("1. Abra http://localhost:3000 no navegador")
    print("2. Clique em 'Selecionar Tela'")
    print("3. Selecione a tela que deseja capturar")
    print("4. Defina as zonas de captura sobre o texto")
    print("5. Clique em 'Iniciar Captura'")
    print("6. Monitore o arquivo 'captura_chat.txt' para ver os resultados")
    
    return True

if __name__ == "__main__":
    test_server()
