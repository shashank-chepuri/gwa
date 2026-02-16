# models/agent_model.py
from datetime import datetime
from bson import ObjectId
import json

class AgentModel:
    """MongoDB model for custom agents"""
    
    def __init__(self, db):
        self.collection = db.agents
    
    def _convert_objectid(self, data):
        """Convert ObjectId to string recursively."""
        if isinstance(data, list):
            return [self._convert_objectid(item) for item in data]
        if isinstance(data, dict):
            return {key: self._convert_objectid(value) for key, value in data.items()}
        if isinstance(data, ObjectId):
            return str(data)
        return data
    
    def create(self, user_id, name, trigger_type, trigger_config, actions):
        """Create a new agent."""
        try:
            agent = {
                'user_id': user_id,
                'name': name,
                'trigger_type': trigger_type,
                'trigger_config': trigger_config,
                'actions': actions,
                'status': 'active',
                'run_count': 0,
                'created_at': datetime.utcnow(),
                'updated_at': datetime.utcnow(),
                'last_run': None
            }
            
            result = self.collection.insert_one(agent)
            agent['_id'] = str(result.inserted_id)  # Convert immediately to string
            print(f"✅ Agent created: {name} for user {user_id}")
            return agent
            
        except Exception as e:
            print(f"⚠️ Error creating agent: {e}")
            return None
    
    def get_user_agents(self, user_id):
        """Get all agents for a user."""
        try:
            cursor = self.collection.find({'user_id': user_id}).sort('created_at', -1)
            agents = list(cursor)
            
            # Convert ObjectId to string for each agent
            for agent in agents:
                agent['_id'] = str(agent['_id'])
            
            return agents
            
        except Exception as e:
            print(f"⚠️ Error getting agents: {e}")
            return []
    
    def get_by_id(self, agent_id, user_id):
        """Get a specific agent by ID."""
        try:
            agent = self.collection.find_one({
                '_id': ObjectId(agent_id),
                'user_id': user_id
            })
            
            if agent:
                agent['_id'] = str(agent['_id'])
            
            return agent
            
        except Exception as e:
            print(f"⚠️ Error getting agent: {e}")
            return None
    
    def update_status(self, agent_id, user_id, status):
        """Update agent status."""
        try:
            result = self.collection.update_one(
                {'_id': ObjectId(agent_id), 'user_id': user_id},
                {'$set': {
                    'status': status,
                    'updated_at': datetime.utcnow()
                }}
            )
            
            success = result.modified_count > 0
            if success:
                print(f"✅ Agent {agent_id} status updated to: {status}")
            
            return success
            
        except Exception as e:
            print(f"⚠️ Error updating agent status: {e}")
            return False
    
    def increment_run_count(self, agent_id, success=True):
        """Increment the run count for an agent."""
        try:
            update_data = {
                '$inc': {'run_count': 1},
                '$set': {
                    'last_run': datetime.utcnow(),
                    'updated_at': datetime.utcnow()
                }
            }
            
            result = self.collection.update_one(
                {'_id': ObjectId(agent_id)},
                update_data
            )
            
            return result.modified_count > 0
            
        except Exception as e:
            print(f"⚠️ Error incrementing run count: {e}")
            return False
    
    def delete(self, agent_id, user_id):
        """Permanently delete an agent."""
        try:
            # Get agent info for logging
            agent = self.collection.find_one({
                '_id': ObjectId(agent_id),
                'user_id': user_id
            })
            
            if not agent:
                return False
            
            # Delete the agent
            result = self.collection.delete_one({
                '_id': ObjectId(agent_id),
                'user_id': user_id
            })
            
            success = result.deleted_count > 0
            if success:
                print(f"🗑️ Agent deleted: {agent.get('name')}")
            
            return success
            
        except Exception as e:
            print(f"⚠️ Error deleting agent: {e}")
            return False
    
    def get_stats(self, user_id):
        """Get agent statistics."""
        try:
            total = self.collection.count_documents({'user_id': user_id})
            active = self.collection.count_documents({
                'user_id': user_id,
                'status': 'active'
            })
            paused = self.collection.count_documents({
                'user_id': user_id,
                'status': 'paused'
            })
            terminated = self.collection.count_documents({
                'user_id': user_id,
                'status': 'terminated'
            })
            
            return {
                'total': total,
                'active': active,
                'paused': paused,
                'terminated': terminated
            }
            
        except Exception as e:
            print(f"⚠️ Error getting stats: {e}")
            return {
                'total': 0,
                'active': 0,
                'paused': 0,
                'terminated': 0
            }