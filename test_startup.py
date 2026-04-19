#!/usr/bin/env python
"""Quick startup test to find where app.py hangs."""

import sys
import os
sys.path.insert(0, '.')

print("1. Testing basic imports...")
from flask import Flask
print("   ✓ Flask OK")

print("2. Testing PyMongo...")
from flask_pymongo import PyMongo
print("   ✓ PyMongo OK")

print("3. Testing environment...")
from dotenv import load_dotenv
load_dotenv()
print("   ✓ .env loaded")

print("4. Testing services...")
from services.google_service import init_google_services
print("   ✓ Google service OK")

print("5. Testing handlers...")
from handlers.command_handler import CommandHandler
print("   ✓ Command handler OK")

print("6. Testing models...")
from models.friend_model import FriendModel
print("   ✓ Friend model OK")

print("7. Testing SocketIO...")
from flask_socketio import SocketIO
print("   ✓ SocketIO OK")

print("\n✅ All imports successful!")
print("\nNow trying to instantiate Flask app...")

app = Flask(__name__)
app.secret_key = "test"
app.config["MONGO_URI"] = os.getenv("MONGO_URI", "mongodb://localhost:27017/workspace_agent")

print("   ✓ Flask app created")

print("\nTesting MongoDB connection...")
mongo = PyMongo(app)
print("   ✓ PyMongo attached")

try:
    print("\n   Pinging MongoDB...")
    with app.app_context():
        mongo.db.command('ping')
    print("   ✓ MongoDB OK")
except Exception as e:
    print(f"   ⚠️ MongoDB error: {e}")

print("\n✅ Startup test complete!")
