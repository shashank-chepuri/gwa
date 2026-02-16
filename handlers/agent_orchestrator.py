# handlers/agent_orchestrator.py
import re
import time
import threading
from datetime import datetime, timedelta
import schedule
from bson import ObjectId
import base64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
import requests

class AgentOrchestrator:
    """Manages custom agents and their execution"""
    
    def __init__(self, db, google_services):
        self.db = db
        self.agents_collection = db.agents
        self.google_services = google_services
        self.gmail_service = google_services.get('gmail')
        self.tasks_service = google_services.get('tasks')
        self.drive_service = google_services.get('drive')
        self.running = True
        self.thread = None
        self.email_monitor_thread = None
        
        # Import friend model
        from models.friend_model import FriendModel
        self.friend_model = FriendModel(db)
        
        self.start_scheduler()
        self.start_email_monitoring()
    
    def start_scheduler(self):
        """Start background thread to check scheduled agents"""
        def run_scheduler():
            while self.running:
                schedule.run_pending()
                time.sleep(60)
        
        self.thread = threading.Thread(target=run_scheduler, daemon=True)
        self.thread.start()
        print("✅ Agent orchestrator started")
    
    def start_email_monitoring(self):
        """Start background thread to check for new emails"""
        def monitor_emails():
            print("📧 Email monitoring started")
            while self.running:
                try:
                    time.sleep(30)
                except Exception as e:
                    print(f"❌ Email monitoring error: {e}")
                    time.sleep(60)
        
        self.email_monitor_thread = threading.Thread(target=monitor_emails, daemon=True)
        self.email_monitor_thread.start()
    
    def stop(self):
        """Stop the orchestrator"""
        self.running = False
    
    def refresh_token_with_scopes(self, credentials_dict):
        """Manually refresh token while preserving scopes."""
        try:
            from google.oauth2.credentials import Credentials
            
            if not credentials_dict:
                print("❌ No credentials dictionary provided")
                return None
            
            creds = Credentials.from_authorized_user_info(credentials_dict)
            
            if not creds.refresh_token:
                print("❌ No refresh token available")
                return None
            
            print(f"🔄 Refreshing token for client: {creds.client_id[:10]}...")
            
            token_url = "https://oauth2.googleapis.com/token"
            data = {
                'client_id': creds.client_id,
                'client_secret': creds.client_secret,
                'refresh_token': creds.refresh_token,
                'grant_type': 'refresh_token'
            }
            
            response = requests.post(token_url, data=data)
            
            if response.status_code == 200:
                token_data = response.json()
                print("✅ Token manually refreshed with scopes preserved")
                
                new_creds = {
                    'token': token_data['access_token'],
                    'refresh_token': creds.refresh_token,
                    'token_uri': creds.token_uri,
                    'client_id': creds.client_id,
                    'client_secret': creds.client_secret,
                    'scopes': creds.scopes
                }
                
                print(f"📋 Preserved {len(creds.scopes)} scopes")
                return new_creds
            else:
                print(f"❌ Token refresh failed: {response.status_code}")
                print(f"   Response: {response.text}")
                return None
                
        except Exception as e:
            print(f"❌ Error in token refresh: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def resolve_recipients(self, user_id, recipients):
        """Resolve friend names to email addresses"""
        resolved = []
        for recipient in recipients:
            # Check if it's already an email
            if '@' in recipient:
                resolved.append(recipient)
                print(f"         ✅ Using email directly: {recipient}")
            else:
                # Try to resolve friend name to email
                email = self.friend_model.resolve_name_to_email(user_id, recipient)
                if email:
                    resolved.append(email)
                    print(f"         ✅ Resolved friend '{recipient}' to '{email}'")
                else:
                    # Keep original for error handling
                    resolved.append(recipient)
                    print(f"         ⚠️ Could not resolve '{recipient}' - not found in friends")
        
        return resolved
    
    def create_agent_from_natural_language(self, user_id, description):
        """Parse natural language to create an agent"""
        try:
            print(f"🔨 Creating agent from description: '{description}'")
            
            name = self._extract_name(description)
            trigger_type, trigger_config = self._parse_trigger(description)
            actions = self._parse_actions(description, user_id)
            
            print(f"   📝 Parsed - Name: {name}, Trigger: {trigger_type}, Actions: {actions}")
            
            if not actions:
                return {'success': False, 'message': 'No actions detected in description'}
            
            from models.agent_model import AgentModel
            agent_model = AgentModel(self.db)
            
            agent = agent_model.create(
                user_id=user_id,
                name=name,
                trigger_type=trigger_type,
                trigger_config=trigger_config,
                actions=actions
            )
            
            if trigger_type == 'time' and trigger_config.get('schedule'):
                self._schedule_agent(agent['_id'], trigger_config['schedule'])
            
            print(f"✅ Agent created successfully with ID: {agent['_id']}")
            return {'success': True, 'agent': agent, 'message': 'Agent created successfully'}
            
        except Exception as e:
            print(f"❌ Error creating agent: {e}")
            import traceback
            traceback.print_exc()
            return {'success': False, 'message': str(e)}
    
    def _extract_name(self, description):
        """Extract agent name from description.
        Examples:
        - "call it Email Forwarder" -> "Email Forwarder"
        - "name it Task Creator" -> "Task Creator"
        - "called Report Summarizer" -> "Report Summarizer"
        - Default: first 4 words of description
        """
        # Pattern for "call it X" or "name it X"
        name_match = re.search(r'(?:call|name)(?:\s+it)?\s+[\'"]?([a-zA-Z0-9\s_-]+)[\'"]?', description, re.IGNORECASE)
        if name_match:
            return name_match.group(1).strip()
        
        # Pattern for "named X" or "called X"
        name_match = re.search(r'(?:named|called)\s+[\'"]?([a-zA-Z0-9\s_-]+)[\'"]?', description, re.IGNORECASE)
        if name_match:
            return name_match.group(1).strip()
        
        # Pattern for "X:" at the beginning (e.g., "Email Forwarder: when I get email...")
        name_match = re.match(r'^([a-zA-Z0-9\s_-]+):', description.strip())
        if name_match:
            return name_match.group(1).strip()
        
        # If no name specified, create a default name from the first few words
        words = description.split()[:4]
        base_name = ' '.join(words).title()
        
        # Add trigger type suffix for clarity
        desc_lower = description.lower()
        if 'email' in desc_lower:
            return f"{base_name} (Email)"
        elif 'task' in desc_lower:
            return f"{base_name} (Task)"
        elif 'file' in desc_lower or 'folder' in desc_lower:
            return f"{base_name} (File)"
        elif 'meet' in desc_lower or 'meeting' in desc_lower:
            return f"{base_name} (Meeting)"
        else:
            return base_name
    
    def _parse_trigger(self, description):
        desc_lower = description.lower()
        
        email_match = re.search(r'(?:when|if)\s+(?:i\s+)?get\s+email\s+from\s+([^\s]+@[^\s]+|\w+)', desc_lower)
        if email_match:
            sender = email_match.group(1)
            print(f"   🔍 Detected email trigger for sender: {sender}")
            return 'email', {
                'type': 'email_received',
                'condition': 'sender_matches',
                'value': sender,
                'check_interval': 1
            }
        
        time_match = re.search(r'every\s+(\w+)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?', desc_lower)
        if time_match:
            day = time_match.group(1)
            hour = int(time_match.group(2))
            minute = int(time_match.group(3)) if time_match.group(3) else 0
            ampm = time_match.group(4)
            
            if ampm:
                if ampm.lower() == 'pm' and hour < 12:
                    hour += 12
                elif ampm.lower() == 'am' and hour == 12:
                    hour = 0
            
            print(f"   🔍 Detected time trigger: {day} at {hour}:{minute:02d}")
            return 'time', {
                'day': day,
                'hour': hour,
                'minute': minute,
                'schedule': f"{hour:02d}:{minute:02d}"
            }
        
        daily_match = re.search(r'every\s+day\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?', desc_lower)
        if daily_match:
            hour = int(daily_match.group(1))
            minute = int(daily_match.group(2)) if daily_match.group(2) else 0
            ampm = daily_match.group(3)
            
            if ampm:
                if ampm.lower() == 'pm' and hour < 12:
                    hour += 12
                elif ampm.lower() == 'am' and hour == 12:
                    hour = 0
            
            print(f"   🔍 Detected daily trigger at {hour}:{minute:02d}")
            return 'time', {
                'day': 'daily',
                'hour': hour,
                'minute': minute,
                'schedule': f"{hour:02d}:{minute:02d}"
            }
        
        file_match = re.search(r'file\s+(?:uploaded|added)\s+to\s+(.+)', desc_lower)
        if file_match:
            folder = file_match.group(1).strip()
            print(f"   🔍 Detected file trigger for folder: {folder}")
            return 'file', {
                'folder': folder,
                'event': 'added'
            }
        
        print("   ⚠️ No trigger detected, using manual")
        return 'manual', {}
    
    def _parse_actions(self, description, user_id):
        """Parse actions and resolve friend names to emails"""
        actions = []
        desc_lower = description.lower()
        
        # Forward email action
        forward_match = re.search(r'forward\s+it\s+to\s+([\w\s,.@]+)', desc_lower)
        if forward_match:
            recipients_text = forward_match.group(1)
            # Split by commas and clean up
            raw_recipients = [r.strip() for r in recipients_text.split(',')]
            
            # Resolve friend names to emails
            recipients = self.resolve_recipients(user_id, raw_recipients)
            
            actions.append({
                'type': 'forward_email',
                'recipients': recipients
            })
            print(f"   📧 Detected forward action to: {recipients}")
        
        # Reply action
        reply_match = re.search(r'reply\s+with\s+[\'"]([^\'"]+)[\'"]', description)
        if reply_match:
            actions.append({
                'type': 'send_reply',
                'message': reply_match.group(1)
            })
            print(f"   💬 Detected reply action")
        
        # Create task action
        task_match = re.search(r'create\s+task\s+[\'"]([^\'"]+)[\'"]', description)
        if task_match:
            actions.append({
                'type': 'create_task',
                'title': task_match.group(1)
            })
            print(f"   📋 Detected task creation: {task_match.group(1)}")
        
        # Summarize action
        if 'summarize' in desc_lower and ('email' in desc_lower or 'it' in desc_lower):
            actions.append({
                'type': 'summarize_and_email'
            })
            print(f"   📄 Detected summarize action")
        
        # List tasks action
        if 'list my pending tasks' in desc_lower:
            actions.append({
                'type': 'list_tasks'
            })
            print(f"   📋 Detected list tasks action")
        
        return actions
    
    def _schedule_agent(self, agent_id, schedule_time):
        def job():
            self.execute_agent(agent_id)
        
        schedule.every().day.at(schedule_time).do(job)
        print(f"📅 Scheduled agent {agent_id} at {schedule_time}")
    
    def execute_agent(self, agent_id):
        try:
            from models.agent_model import AgentModel
            agent_model = AgentModel(self.db)
            
            agent = self.agents_collection.find_one({'_id': ObjectId(agent_id)})
            if not agent or agent.get('status') != 'active':
                return
            
            user_id = agent.get('user_id')
            print(f"⚙️ Executing agent: {agent.get('name')} for user {user_id}")
            
            self._execute_actions(agent, user_id)
            agent_model.increment_run_count(agent_id, True)
            
        except Exception as e:
            print(f"❌ Agent execution failed: {e}")
    
    def check_email_triggers(self, user_id, credentials_dict=None):
        """Check for new emails that match agent triggers - DEBUG VERSION"""
        print("\n" + "=" * 80)
        print(f"🔍 EMAIL CHECK STARTED for {user_id}")
        print("=" * 80)
        
        if not self.gmail_service:
            print("❌ Gmail service not available")
            return
        
        try:
            # Test Gmail connection
            try:
                profile = self.gmail_service.users().getProfile(userId='me').execute()
                print(f"✅ Gmail API connected for {profile.get('emailAddress', 'unknown')}")
            except Exception as e:
                error_str = str(e)
                if 'insufficient authentication scopes' in error_str or '403' in error_str:
                    print("❌ Scope issue detected. Attempting token refresh...")
                    
                    if credentials_dict:
                        new_creds = self.refresh_token_with_scopes(credentials_dict)
                        if new_creds:
                            print("✅ Token refreshed, recreating Gmail service...")
                            from googleapiclient.discovery import build
                            from google.oauth2.credentials import Credentials
                            
                            creds_obj = Credentials.from_authorized_user_info(new_creds)
                            self.gmail_service = build('gmail', 'v1', credentials=creds_obj)
                            self.google_services['gmail'] = self.gmail_service
                            
                            try:
                                profile = self.gmail_service.users().getProfile(userId='me').execute()
                                print(f"✅ Gmail API reconnected")
                            except Exception as retry_error:
                                print(f"❌ Still failing: {retry_error}")
                                return
                        else:
                            print("❌ Manual refresh failed")
                            return
                    else:
                        print("❌ No credentials provided")
                        return
                else:
                    print(f"❌ Gmail API connection failed: {e}")
                    return
            
            # Get all active email-triggered agents
            agents = list(self.agents_collection.find({
                'user_id': user_id,
                'status': 'active',
                'trigger_type': 'email'
            }))
            
            print(f"📊 Found {len(agents)} active email-triggered agents")
            
            if not agents:
                print("📭 No email agents found. Create one first!")
                return
            
            # List all agents for debugging
            for i, agent in enumerate(agents):
                trigger_config = agent.get('trigger_config', {})
                expected_sender = trigger_config.get('value', 'NOT SET')
                actions = agent.get('actions', [])
                print(f"   Agent {i+1}: '{agent.get('name')}' - Expects: '{expected_sender}' - Actions: {len(actions)}")
            
            # Get unread emails
            print("📥 Fetching unread emails...")
            results = self.gmail_service.users().messages().list(
                userId='me',
                q='is:unread',
                maxResults=20
            ).execute()
            
            messages = results.get('messages', [])
            print(f"📧 Found {len(messages)} unread messages")
            
            if not messages:
                print("📭 No unread messages to process")
                return
            
            # Process each email
            for idx, msg in enumerate(messages):
                print(f"\n--- Processing email {idx+1}/{len(messages)} ---")
                
                try:
                    message = self.gmail_service.users().messages().get(
                        userId='me',
                        id=msg['id'],
                        format='metadata',
                        metadataHeaders=['From', 'Subject', 'To']
                    ).execute()
                    
                    headers = message.get('payload', {}).get('headers', [])
                    sender = ''
                    subject = ''
                    
                    for header in headers:
                        if header['name'] == 'From':
                            sender = header['value']
                            # Extract email from "Name <email>" format
                            email_match = re.search(r'<(.+?)>', sender)
                            if email_match:
                                sender = email_match.group(1)
                            print(f"   📨 From: {sender}")
                        elif header['name'] == 'Subject':
                            subject = header['value']
                            print(f"   📧 Subject: {subject[:50]}...")
                    
                    # Check against each agent
                    print(f"   🔍 Checking against {len(agents)} agents...")
                    matched = False
                    
                    for agent in agents:
                        trigger_config = agent.get('trigger_config', {})
                        expected_sender = trigger_config.get('value', '').lower()
                        agent_name = agent.get('name', 'Unnamed')
                        
                        print(f"      Agent '{agent_name}' expects: '{expected_sender}'")
                        print(f"      Comparing with sender: '{sender.lower()}'")
                        
                        if expected_sender and expected_sender in sender.lower():
                            print(f"      ✅ MATCH FOUND for agent: {agent_name}")
                            matched = True
                            
                            # Execute actions with resolved recipients
                            print(f"      🎯 Executing {len(agent.get('actions', []))} actions...")
                            
                            # Resolve any friend names in the agent's actions before execution
                            resolved_agent = self._resolve_agent_recipients(agent, user_id)
                            
                            self._execute_actions(resolved_agent, user_id, email_context={
                                'message_id': msg['id'],
                                'sender': sender,
                                'subject': subject,
                                'thread_id': message.get('threadId')
                            })
                            
                            # Mark as read
                            try:
                                self.gmail_service.users().messages().modify(
                                    userId='me',
                                    id=msg['id'],
                                    body={'removeLabelIds': ['UNREAD']}
                                ).execute()
                                print("      ✅ Marked as read")
                            except Exception as e:
                                print(f"      ⚠️ Could not mark as read: {e}")
                            
                            break  # Stop checking other agents for this email
                    
                    if not matched:
                        print("      ❌ No matching agent found for this email")
                    
                except Exception as e:
                    print(f"❌ Error processing message: {e}")
                    import traceback
                    traceback.print_exc()
            
            print("=" * 80 + "\n")
                    
        except Exception as e:
            print(f"❌ Error in check_email_triggers: {e}")
            import traceback
            traceback.print_exc()
    
    def _resolve_agent_recipients(self, agent, user_id):
        """Resolve friend names to emails in all actions of an agent"""
        resolved_agent = agent.copy()
        
        for action in resolved_agent.get('actions', []):
            if action.get('type') == 'forward_email' and 'recipients' in action:
                original_recipients = action.get('recipients', [])
                resolved_recipients = self.resolve_recipients(user_id, original_recipients)
                action['recipients'] = resolved_recipients
                print(f"      🔄 Resolved recipients: {original_recipients} -> {resolved_recipients}")
            
            # Add other action types that might have recipients here
            elif action.get('type') == 'summarize_and_email' and 'recipients' in action:
                original_recipients = action.get('recipients', [])
                resolved_recipients = self.resolve_recipients(user_id, original_recipients)
                action['recipients'] = resolved_recipients
        
        return resolved_agent
    
    def _execute_actions(self, agent, user_id, email_context=None):
        """Execute all actions for an agent with debug output"""
        print(f"   🎬 EXECUTING ACTIONS for agent: {agent.get('name')}")
        success = True
        
        for action_idx, action in enumerate(agent.get('actions', [])):
            action_type = action.get('type')
            print(f"      Action {action_idx+1}: {action_type}")
            
            try:
                if action_type == 'forward_email':
                    self._forward_email(action, user_id, email_context)
                elif action_type == 'create_task':
                    self._create_task(action, user_id)
                elif action_type == 'send_reply':
                    self._send_reply(action, user_id, email_context)
                elif action_type == 'summarize_and_email':
                    self._summarize_and_email(action, user_id, email_context)
                elif action_type == 'list_tasks':
                    self._list_tasks(action, user_id)
                elif action_type == 'notify':
                    print(f"         Notification: {action.get('message')}")
                else:
                    print(f"         ❌ Unknown action type: {action_type}")
            except Exception as e:
                print(f"         ❌ Action failed: {e}")
                import traceback
                traceback.print_exc()
                success = False
        
        # Update agent stats
        from models.agent_model import AgentModel
        agent_model = AgentModel(self.db)
        agent_model.increment_run_count(agent['_id'], success)
        print(f"   ✅ Agent stats updated - Run count increased")
    
    def _forward_email(self, action, user_id, email_context=None):
        """Forward an email using Gmail API with debug output"""
        recipients = action.get('recipients', [])
        print(f"         📧 FORWARDING to: {recipients}")
        
        if not self.gmail_service:
            print("         ❌ Gmail service not available")
            return
        
        if not email_context:
            print("         ❌ No email context for forwarding")
            return
        
        try:
            print(f"         Fetching original message: {email_context['message_id']}")
            original_msg = self.gmail_service.users().messages().get(
                userId='me',
                id=email_context['message_id'],
                format='raw'
            ).execute()
            print(f"         ✅ Original message fetched")
            
            for recipient in recipients:
                print(f"         📤 Sending to {recipient}...")
                
                # Check if recipient is a valid email (should be resolved by now)
                if '@' not in recipient:
                    print(f"         ⚠️ Recipient '{recipient}' is not a valid email address")
                    print(f"         💡 Make sure to add '{recipient}' as a friend with their email")
                    continue
                
                message = MIMEMultipart()
                message['to'] = recipient
                message['subject'] = f"Fwd: {email_context.get('subject', 'No Subject')}"
                message['from'] = 'me'
                
                body = f"---------- Forwarded message ----------\n"
                body += f"From: {email_context.get('sender')}\n"
                body += f"Subject: {email_context.get('subject')}\n\n"
                body += "Original message attached."
                
                message.attach(MIMEText(body, 'plain'))
                
                raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
                
                send_result = self.gmail_service.users().messages().send(
                    userId='me',
                    body={'raw': raw}
                ).execute()
                
                print(f"         ✅ Email forwarded to {recipient} - Message ID: {send_result.get('id')}")
                
        except Exception as e:
            print(f"         ❌ Failed to forward email: {e}")
            import traceback
            traceback.print_exc()
    
    def _create_task(self, action, user_id):
        """Create a task using Tasks API"""
        title = action.get('title', 'Untitled Task')
        print(f"         📋 Creating task: {title}")
        
        if not self.tasks_service:
            print("         ❌ Tasks service not available")
            return
        
        try:
            task_lists = self.tasks_service.tasklists().list().execute().get('items', [])
            if not task_lists:
                task_list = self.tasks_service.tasklists().insert(body={'title': 'My Tasks'}).execute()
                task_list_id = task_list['id']
                print(f"         ✅ Created new task list: My Tasks")
            else:
                task_list_id = task_lists[0]['id']
                print(f"         ✅ Using task list: {task_lists[0].get('title')}")
            
            task = {
                'title': title,
                'notes': f'Created by agent at {datetime.now().strftime("%Y-%m-%d %H:%M")}',
                'due': (datetime.now() + timedelta(days=1)).isoformat() + 'Z'
            }
            
            result = self.tasks_service.tasks().insert(
                tasklist=task_list_id,
                body=task
            ).execute()
            
            print(f"         ✅ Task created: {result.get('title')} (ID: {result.get('id')})")
            
        except Exception as e:
            print(f"         ❌ Failed to create task: {e}")
    
    def _send_reply(self, action, user_id, email_context=None):
        """Send a reply email"""
        message_text = action.get('message', '')
        print(f"         💬 Sending reply: {message_text}")
        
        if not self.gmail_service:
            print("         ❌ Gmail service not available")
            return
        
        if not email_context:
            print("         ❌ No email context for reply")
            return
        
        try:
            message = MIMEText(message_text)
            message['to'] = email_context.get('sender')
            message['subject'] = f"Re: {email_context.get('subject', 'No Subject')}"
            message['from'] = 'me'
            message['In-Reply-To'] = email_context.get('message_id')
            message['References'] = email_context.get('message_id')
            
            raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
            
            send_result = self.gmail_service.users().messages().send(
                userId='me',
                body={'raw': raw}
            ).execute()
            
            print(f"         ✅ Reply sent - Message ID: {send_result.get('id')}")
            
        except Exception as e:
            print(f"         ❌ Failed to send reply: {e}")
    
    def _summarize_and_email(self, action, user_id, email_context=None):
        """Summarize a document and email it"""
        print("         📄 Summarize feature coming soon...")
    
    def _list_tasks(self, action, user_id):
        """List pending tasks"""
        print("         📋 Listing pending tasks")
        
        if not self.tasks_service:
            print("         ❌ Tasks service not available")
            return
        
        try:
            task_lists = self.tasks_service.tasklists().list().execute().get('items', [])
            if not task_lists:
                print("         No task lists found")
                return
            
            task_list_id = task_lists[0]['id']
            print(f"         Using task list: {task_lists[0].get('title')}")
            
            tasks = self.tasks_service.tasks().list(
                tasklist=task_list_id,
                showCompleted=False
            ).execute().get('items', [])
            
            print(f"         Found {len(tasks)} pending tasks:")
            for task in tasks:
                due = task.get('due', 'No due date')
                print(f"           • {task.get('title')} (Due: {due})")
                
        except Exception as e:
            print(f"         ❌ Failed to list tasks: {e}")