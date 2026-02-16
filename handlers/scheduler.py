# handlers/scheduler.py
from datetime import datetime, timedelta
import pytz
from collections import defaultdict

class SmartScheduler:
    """Suggests optimal meeting/task times based on calendar and patterns"""
    
    def __init__(self, calendar_service, task_handler):
        self.calendar = calendar_service
        self.tasks = task_handler
    
    def suggest_meeting_time(self, user_id, attendees=None, duration_minutes=60, days_ahead=7):
        """Suggest best time for a meeting"""
        
        # Get user's calendar for next X days
        now = datetime.utcnow().isoformat() + 'Z'
        later = (datetime.utcnow() + timedelta(days=days_ahead)).isoformat() + 'Z'
        
        try:
            events_result = self.calendar.events().list(
                calendarId='primary',
                timeMin=now,
                timeMax=later,
                singleEvents=True,
                orderBy='startTime'
            ).execute()
            
            events = events_result.get('items', [])
        except:
            events = []
        
        # Parse busy times
        busy_times = []
        for event in events:
            start = event['start'].get('dateTime', event['start'].get('date'))
            end = event['end'].get('dateTime', event['end'].get('date'))
            busy_times.append((start, end))
        
        # Find available slots (9 AM - 5 PM, weekdays)
        suggestions = []
        current = datetime.now()
        
        for day in range(days_ahead):
            day_date = current + timedelta(days=day)
            
            # Skip weekends
            if day_date.weekday() >= 5:  # 5=Saturday, 6=Sunday
                continue
            
            # Business hours: 9 AM to 5 PM
            day_start = datetime(day_date.year, day_date.month, day_date.day, 9, 0)
            day_end = datetime(day_date.year, day_date.month, day_date.day, 17, 0)
            
            slot_start = day_start
            while slot_start + timedelta(minutes=duration_minutes) <= day_end:
                slot_end = slot_start + timedelta(minutes=duration_minutes)
                
                # Check if slot conflicts with any busy time
                conflict = False
                for busy_start, busy_end in busy_times:
                    if self._overlaps(slot_start, slot_end, busy_start, busy_end):
                        conflict = True
                        break
                
                if not conflict:
                    # Score the slot (earlier = better, but not too early)
                    hours_from_now = (slot_start - current).total_seconds() / 3600
                    score = 100 - abs(hours_from_now - 48)  # Prefer ~2 days out
                    
                    suggestions.append({
                        'start': slot_start.isoformat(),
                        'end': slot_end.isoformat(),
                        'score': max(0, score),
                        'display': slot_start.strftime('%A, %B %d at %I:%M %p')
                    })
                
                slot_start += timedelta(minutes=30)  # 30-min increments
        
        # Sort by score
        suggestions.sort(key=lambda x: x['score'], reverse=True)
        return suggestions[:5]  # Top 5 suggestions
    
    def suggest_task_time(self, user_id, task_description, preferred_time=None):
        """Suggest best time to schedule a task based on user patterns"""
        
        # Default suggestion
        tomorrow_10am = (datetime.now() + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
        
        # In a real implementation, you'd analyze user history
        return {
            'suggested_time': tomorrow_10am.isoformat(),
            'display': tomorrow_10am.strftime('%A, %B %d at %I:%M %p'),
            'reason': "Suggested default time (tomorrow 10 AM)"
        }
    
    def _overlaps(self, start1, end1, start2, end2):
        """Check if two time ranges overlap"""
        # Convert to datetime if they're strings
        if isinstance(start1, str):
            try:
                start1 = datetime.fromisoformat(start1.replace('Z', '+00:00'))
            except:
                start1 = datetime.now()
        if isinstance(end1, str):
            try:
                end1 = datetime.fromisoformat(end1.replace('Z', '+00:00'))
            except:
                end1 = datetime.now()
        if isinstance(start2, str):
            try:
                start2 = datetime.fromisoformat(start2.replace('Z', '+00:00'))
            except:
                start2 = datetime.now()
        if isinstance(end2, str):
            try:
                end2 = datetime.fromisoformat(end2.replace('Z', '+00:00'))
            except:
                end2 = datetime.now()
        
        return max(start1, start2) < min(end1, end2)