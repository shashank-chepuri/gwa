# models/friend_model.py
from datetime import datetime
from bson import ObjectId
from bson.json_util import dumps
import json
import re

class FriendModel:
    """MongoDB model for friends/contacts"""
    
    def __init__(self, db):
        self.collection = db.friends
    
    def to_json(self, data):
        """Convert MongoDB ObjectId to string for JSON serialization."""
        return json.loads(dumps(data))
    
    def get_all(self, user_id):
        """Get all friends for a user, sorted by name."""
        try:
            cursor = self.collection.find(
                {'user_id': user_id}
            ).sort('name', 1)
            return self.to_json(list(cursor))
        except Exception as e:
            print(f"⚠️ Error getting friends: {e}")
            return []
    
    def get_by_id(self, friend_id, user_id):
        """Get a specific friend by ID."""
        try:
            obj_id = ObjectId(friend_id)
            friend = self.collection.find_one({
                '_id': obj_id,
                'user_id': user_id
            })
            return self.to_json(friend) if friend else None
        except Exception as e:
            print(f"⚠️ Error getting friend: {e}")
            return None
    
    def create(self, user_id, name, email):
        """Create a new friend."""
        try:
            # Check if friend with same name already exists
            existing = self.find_by_name(user_id, name)
            if existing:
                return {'success': False, 'message': 'Friend with this name already exists'}
            
            # Check if email already exists for this user
            existing_email = self.collection.find_one({
                'user_id': user_id,
                'email': email
            })
            if existing_email:
                return {'success': False, 'message': 'Friend with this email already exists'}
            
            friend = {
                'user_id': user_id,
                'name': name.strip(),
                'email': email.strip().lower(),
                'created_at': datetime.utcnow(),
                'updated_at': datetime.utcnow()
            }
            
            result = self.collection.insert_one(friend)
            friend['_id'] = result.inserted_id
            print(f"✅ Friend created: {name} ({email}) for user {user_id}")
            return {'success': True, 'data': self.to_json(friend)}
        except Exception as e:
            print(f"⚠️ Error creating friend: {e}")
            return {'success': False, 'message': str(e)}
    
    def update(self, friend_id, user_id, name=None, email=None):
        """Update a friend."""
        try:
            obj_id = ObjectId(friend_id)
            
            update_data = {'updated_at': datetime.utcnow()}
            if name:
                update_data['name'] = name.strip()
            if email:
                update_data['email'] = email.strip().lower()
            
            result = self.collection.update_one(
                {'_id': obj_id, 'user_id': user_id},
                {'$set': update_data}
            )
            
            if result.modified_count > 0:
                updated = self.collection.find_one({'_id': obj_id})
                print(f"✅ Friend updated: {updated.get('name')}")
                return {'success': True, 'data': self.to_json(updated)}
            return {'success': False, 'message': 'Friend not found or no changes made'}
        except Exception as e:
            print(f"⚠️ Error updating friend: {e}")
            return {'success': False, 'message': str(e)}
    
    def delete(self, friend_id, user_id):
        """Delete a friend."""
        try:
            obj_id = ObjectId(friend_id)
            # Get friend info before deleting
            friend = self.collection.find_one({'_id': obj_id, 'user_id': user_id})
            if friend:
                result = self.collection.delete_one({'_id': obj_id, 'user_id': user_id})
                print(f"✅ Friend deleted: {friend.get('name')}")
                return {'success': True, 'deleted_count': result.deleted_count}
            return {'success': False, 'message': 'Friend not found'}
        except Exception as e:
            print(f"⚠️ Error deleting friend: {e}")
            return {'success': False, 'message': str(e)}
    
    def find_by_name(self, user_id, name):
        """Find friend by name (case-insensitive)."""
        try:
            pattern = re.compile(f'^{re.escape(name)}$', re.IGNORECASE)
            friend = self.collection.find_one({
                'user_id': user_id,
                'name': pattern
            })
            return self.to_json(friend) if friend else None
        except Exception as e:
            print(f"⚠️ Error finding friend by name: {e}")
            return None
    
    def search(self, user_id, query):
        """Search friends by name or email."""
        try:
            regex_pattern = re.compile(query, re.IGNORECASE)
            cursor = self.collection.find({
                'user_id': user_id,
                '$or': [
                    {'name': regex_pattern},
                    {'email': regex_pattern}
                ]
            }).sort('name', 1)
            return self.to_json(list(cursor))
        except Exception as e:
            print(f"⚠️ Error searching friends: {e}")
            return []
    
    def resolve_name_to_email(self, user_id, name):
        """Convert a friend's name to email address."""
        try:
            friend = self.find_by_name(user_id, name)
            if friend:
                print(f"📇 Resolved '{name}' to email: {friend['email']}")
                return friend['email']
            return None
        except Exception as e:
            print(f"⚠️ Error resolving name: {e}")
            return None