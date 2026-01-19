#!/usr/bin/env python3
"""
Test script for ManimGo Custom API Endpoint
"""

import os
import sys
import json
import requests
from dotenv import load_dotenv

load_dotenv()

API_BASE_URL = os.getenv("CUSTOM_API_URL", "").strip() or "https://api.openai.com/v1"
API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-nano")


def test_connection():
    """Test if the API endpoint is reachable"""
    print(f"Testing connection to: {API_BASE_URL}")

    headers = {"Authorization": f"Bearer {API_KEY}"} if API_KEY else {}

    try:
        response = requests.get(f"{API_BASE_URL}/models", headers=headers, timeout=30)
        print(f"Status: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2)}")
        return response.status_code == 200
    except requests.exceptions.RequestException as e:
        print(f"Connection failed: {e}")
        return False


def test_chat_completion():
    """Test chat completion with a simple message"""
    print("\nTesting chat completion...")

    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Say 'Hello' in exactly one word."},
        ],
        "max_tokens": 10,
    }

    try:
        response = requests.post(
            f"{API_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
            timeout=60,
        )
        print(f"Status: {response.status_code}")

        if response.status_code == 200:
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            print(f"Response: {content}")
            return True
        else:
            print(f"Error: {response.text}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")
        return False
    except (KeyError, json.JSONDecodeError) as e:
        print(f"Parse error: {e}")
        return False


def main():
    print("=" * 50)
    print("ManimGo Custom API Endpoint Test")
    print("=" * 50)
    print(f"API URL: {API_BASE_URL}")
    print(f"Model: {MODEL}")
    print(f"API Key: {'Set' if API_KEY else 'Not set'}")
    print("=" * 50)

    if not API_KEY:
        print("\nWARNING: No API key configured!")
        print("Set CUSTOM_API_KEY or OPENAI_API_KEY in .env file")
        sys.exit(1)

    success = test_connection()
    if success:
        success = test_chat_completion()

    print("\n" + "=" * 50)
    if success:
        print("✓ All tests passed!")
        sys.exit(0)
    else:
        print("✗ Tests failed!")
        sys.exit(1)


if __name__ == "__main__":
    main()
