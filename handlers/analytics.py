# handlers/analytics.py
from datetime import datetime, timedelta
from collections import Counter
import pandas as pd

class AnalyticsHandler:
    """Provides advanced analytics on user behavior"""
    
    def __init__(self, history_model, friend_model, task_handler, note_handler):
        self.history = history_model
        self.friends = friend_model
        self.tasks = task_handler
        self.notes = note_handler
    
    def get_user_dashboard(self, user_id, days=30):
        """Complete analytics dashboard for user"""
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        # Get user history
        history = list(self.history.collection.find({
            'user_id': user_id,
            'timestamp': {'$gte': cutoff}
        }))
        
        if not history:
            return {'no_data': True}
        
        # 1. Command usage patterns
        command_counts = {}
        for item in history:
            action = item.get('action', 'unknown')
            command_counts[action] = command_counts.get(action, 0) + 1
        
        # 2. Time-based patterns
        hourly_activity = {}
        for item in history:
            try:
                hour = item['timestamp'].hour
                hourly_activity[hour] = hourly_activity.get(hour, 0) + 1
            except:
                pass
        
        # 3. Success rate
        total = len(history)
        successful = sum(1 for item in history if item.get('success', False))
        success_rate = (successful / total * 100) if total > 0 else 0
        
        # 4. Most used features
        top_features = dict(sorted(command_counts.items(), key=lambda x: x[1], reverse=True)[:5])
        
        # 5. Error analysis
        errors = {}
        for item in history:
            if not item.get('success', True):
                action = item.get('action', 'unknown')
                errors[action] = errors.get(action, 0) + 1
        
        # 6. Friend count
        friends = self.friends.get_all(user_id) if self.friends else []
        friend_count = len(friends)
        
        # 7. Task completion rate
        user_tasks = self.tasks.tasks if self.tasks else []
        user_tasks = [t for t in user_tasks if t.get('user_id') == user_id]
        total_tasks = len(user_tasks)
        completed_tasks = len([t for t in user_tasks if t.get('completed')])
        task_completion_rate = (completed_tasks / total_tasks * 100) if total_tasks > 0 else 0
        
        # Find most active hour
        most_active_hour = max(hourly_activity, key=hourly_activity.get) if hourly_activity else None
        
        return {
            'total_commands': total,
            'command_counts': command_counts,
            'hourly_activity': hourly_activity,
            'success_rate': round(success_rate, 1),
            'top_features': top_features,
            'error_analysis': errors,
            'friend_count': friend_count,
            'task_completion_rate': round(task_completion_rate, 1),
            'most_active_hour': most_active_hour
        }
    
    def suggest_optimizations(self, user_id):
        """Suggest improvements based on usage patterns"""
        dashboard = self.get_user_dashboard(user_id, days=14)
        suggestions = []
        
        if dashboard.get('no_data'):
            return ["Start using the agent to get personalized suggestions!"]
        
        # Suggest based on error patterns
        if dashboard.get('error_analysis'):
            errors = dashboard['error_analysis']
            if errors:
                most_error_prone = max(errors, key=errors.get)
                suggestions.append(f"🔧 You often have issues with '{most_error_prone}'. Try using the help command for guidance.")
        
        # Suggest based on time patterns
        if dashboard.get('most_active_hour') is not None:
            hour = dashboard['most_active_hour']
            if 9 <= hour <= 11:
                suggestions.append("⏰ You're most active in the morning! Schedule important tasks then.")
            elif 14 <= hour <= 16:
                suggestions.append("⏰ Afternoon peak! Good time for meetings.")
        
        # Suggest based on feature usage
        if dashboard.get('friend_count', 0) == 0:
            suggestions.append("👥 You haven't added any friends yet! Add contacts for easier email commands.")
        
        if dashboard.get('task_completion_rate', 100) < 50:
            suggestions.append("📋 Your task completion rate is low. Try breaking down large tasks into smaller ones.")
        
        if dashboard.get('total_commands', 0) < 10:
            suggestions.append("💡 Try exploring more features! Use 'help' to see all commands.")
        
        return suggestions
    
    def get_usage_trends(self, user_id, weeks=4):
        """Get weekly usage trends"""
        trends = []
        now = datetime.utcnow()
        
        for i in range(weeks):
            start = now - timedelta(weeks=i+1)
            end = now - timedelta(weeks=i)
            
            count = self.history.collection.count_documents({
                'user_id': user_id,
                'timestamp': {'$gte': start, '$lt': end}
            })
            
            trends.append({
                'week': f"Week {weeks-i}",
                'commands': count
            })
        
        return trends