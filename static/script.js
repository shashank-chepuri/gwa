// static/script.js

const chatArea = document.getElementById('chatArea');
const commandInput = document.getElementById('commandInput');
const sendButton = document.getElementById('sendButton');
const voiceBtn = document.getElementById('voiceBtn');

let currentDraft = null;
let pendingCommand = null;
let selectedFile = null;
let selectedFileEmail = null;
let activeTab = 'all';
let messageHistory = [];

// Voice recording variables
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let socket;
let recognition = null;
let pendingConfirmation = null;
let confirmationRecognition = null;

// Initialize Socket.IO for voice
function initVoiceConnection() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('🎤 Connected to voice server');
        updateVoiceStatus('Voice ready');
    });
    
    socket.on('transcription', (data) => {
        console.log('Transcription:', data);
        addSystemMessage(`🎤 "${data.text}"`);
        
        // Auto-submit as command
        commandInput.value = data.text;
        sendMessage();
    });
    
    socket.on('error', (data) => {
        console.error('Voice error:', data.message);
        updateVoiceStatus('Voice error', true);
        resetVoiceState();
    });
}

function addSystemMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system-message';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = text;
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    timeDiv.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    messageDiv.appendChild(contentDiv);
    messageDiv.appendChild(timeDiv);
    chatArea.appendChild(messageDiv);
    chatArea.scrollTop = chatArea.scrollHeight;
}

function updateVoiceStatus(text, isError = false) {
    const statusEl = document.getElementById('voiceStatus');
    if (statusEl) {
        statusEl.textContent = text;
        statusEl.style.color = isError ? '#dc3545' : '#6c757d';
    }
}

function resetVoiceState() {
    isRecording = false;
    if (voiceBtn) {
        voiceBtn.classList.remove('recording');
        voiceBtn.innerHTML = '🎤';
        voiceBtn.disabled = false;
    }
    updateVoiceStatus('Voice ready');
}

// Use Web Speech API for recognition
function startWebSpeechAPI() {
    if (pendingConfirmation) {
        addSystemMessage('Please respond to the confirmation first');
        return false;
    }
    
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        updateVoiceStatus('Voice recognition not supported', true);
        return false;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;
    
    let finalTranscript = '';
    
    recognition.onstart = () => {
        console.log('Speech recognition started');
        isRecording = true;
        voiceBtn.classList.add('recording');
        voiceBtn.innerHTML = '⏹️';
        updateVoiceStatus('Listening... Speak now');
    };
    
    recognition.onresult = (event) => {
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
                updateVoiceStatus(`Heard: "${transcript}"`);
            } else {
                interimTranscript += transcript;
                updateVoiceStatus(`Listening: "${interimTranscript}"`);
            }
        }
    };
    
    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        let errorMsg = 'Voice error: ';
        switch(event.error) {
            case 'no-speech':
                errorMsg += 'No speech detected';
                break;
            case 'audio-capture':
                errorMsg += 'No microphone found';
                break;
            case 'not-allowed':
                errorMsg += 'Microphone access denied';
                break;
            default:
                errorMsg += event.error;
        }
        updateVoiceStatus(errorMsg, true);
        stopWebSpeechAPI();
    };
    
    recognition.onend = () => {
        console.log('Speech recognition ended');
        if (finalTranscript) {
            addSystemMessage(`🎤 "${finalTranscript}"`);
            commandInput.value = finalTranscript;
            sendMessage();
        }
        resetVoiceState();
    };
    
    try {
        recognition.start();
        return true;
    } catch (error) {
        console.error('Failed to start recognition:', error);
        updateVoiceStatus('Failed to start voice recognition', true);
        return false;
    }
}

function stopWebSpeechAPI() {
    if (recognition) {
        try {
            recognition.stop();
        } catch (error) {
            console.error('Error stopping recognition:', error);
        }
        recognition = null;
    }
    resetVoiceState();
}

// Start listening for confirmation
function startVoiceConfirmation() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        addSystemMessage('Please type "yes" or "no" to confirm');
        return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    confirmationRecognition = new SpeechRecognition();
    
    confirmationRecognition.continuous = false;
    confirmationRecognition.interimResults = false;
    confirmationRecognition.lang = 'en-US';
    
    confirmationRecognition.onstart = () => {
        updateVoiceStatus('Waiting for confirmation...');
    };
    
    confirmationRecognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.toLowerCase().trim();
        addSystemMessage(`🎤 "${transcript}"`);
        
        if (transcript.includes('yes') || transcript.includes('yeah') || transcript.includes('yep') || transcript.includes('sure') || transcript.includes('confirm')) {
            // User confirmed
            executePendingConfirmation();
        } else if (transcript.includes('no') || transcript.includes('nope') || transcript.includes('cancel') || transcript.includes('stop')) {
            // User cancelled
            addMessage('❌ Operation cancelled', 'bot');
            pendingConfirmation = null;
            updateVoiceStatus('Voice ready');
        } else {
            // Ask again
            addSystemMessage('Please say "yes" to confirm or "no" to cancel');
            startVoiceConfirmation();
        }
    };
    
    confirmationRecognition.onerror = (event) => {
        console.error('Confirmation recognition error:', event.error);
        addSystemMessage('Please type "yes" or "no" to confirm');
    };
    
    confirmationRecognition.onend = () => {
        confirmationRecognition = null;
    };
    
    try {
        confirmationRecognition.start();
    } catch (error) {
        console.error('Failed to start confirmation recognition:', error);
        addSystemMessage('Please type "yes" or "no" to confirm');
    }
}

// Execute the pending confirmation
function executePendingConfirmation() {
    if (!pendingConfirmation) return;
    
    addLoadingMessage();
    
    if (pendingConfirmation.type === 'delete_all_events') {
        // Send confirmation to server
        fetch('/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                command: 'confirm delete all events',
                confirmation_data: pendingConfirmation.data
            })
        })
        .then(res => res.json())
        .then(data => {
            removeLoadingMessage();
            if (data.success) {
                addMessage(`✅ ${data.message}`, 'bot');
            } else {
                addMessage(`❌ ${data.message}`, 'bot');
            }
            pendingConfirmation = null;
            updateVoiceStatus('Voice ready');
        })
        .catch(err => {
            removeLoadingMessage();
            addMessage('Error processing confirmation', 'bot');
            pendingConfirmation = null;
            updateVoiceStatus('Voice ready');
        });
    }
}

// Toggle voice recording
function toggleVoiceRecording() {
    if (pendingConfirmation) {
        addSystemMessage('Please respond to the confirmation first');
        return;
    }
    
    if (isRecording) {
        stopWebSpeechAPI();
    } else {
        startWebSpeechAPI();
    }
}

// Text-to-Speech function
function speakText(text) {
    if (!text) return;
    
    // Don't speak if it's a system message or too long
    if (text.length > 200 || text.includes('```') || text.includes('help')) return;
    
    if ('speechSynthesis' in window) {
        // Cancel any ongoing speech
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        
        // Get available voices
        const voices = speechSynthesis.getVoices();
        const englishVoice = voices.find(voice => voice.lang.includes('en'));
        if (englishVoice) {
            utterance.voice = englishVoice;
        }
        
        utterance.onerror = (event) => {
            console.error('Speech synthesis error:', event);
        };
        
        speechSynthesis.speak(utterance);
    }
}

// Send message on button click or Enter
sendButton.addEventListener('click', sendMessage);
commandInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// Voice button click
if (voiceBtn) {
    voiceBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleVoiceRecording();
    });
}

// Keyboard shortcut for voice (Ctrl+M)
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'm') {
        e.preventDefault();
        toggleVoiceRecording();
    }
});

function sendMessage() {
    const command = commandInput.value.trim();
    if (!command) return;

    addMessage(command, 'user');
    commandInput.value = '';
    sendCommand(command);
}

function sendCommand(command) {
    addLoadingMessage();

    fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: command })
    })
    .then(res => res.json())
    .then(data => {
        removeLoadingMessage();
        handleResponse(data, command);
        
        // Speak the response if it's a success message
        if (data.success && data.message) {
            // Don't speak help text (it's too long)
            if (data.action !== 'help') {
                speakText(data.message);
            }
        }
    })
    .catch(err => {
        removeLoadingMessage();
        addMessage('Error: Could not connect to server', 'bot');
    });
}

function handleResponse(data, originalCommand) {
    if (!data.success) {
        if (data.needs_interactive) {
            showModal('draftModal');
            pendingCommand = originalCommand;
        } else if (data.needs_recipients) {
            showModal('recipientsModal');
        } else {
            addMessage(`❌ ${data.message}`, 'bot');
        }
        return;
    }

    switch(data.action) {
        case 'list_tasks':
            displayTasks(data.data);
            break;
        case 'add_task':
            addMessage(`✅ ${data.message}`, 'bot');
            if (data.data) displayTaskItem(data.data);
            break;
        case 'complete_task':
        case 'delete_task':
            addMessage(`✅ ${data.message}`, 'bot');
            break;
        
        case 'list_notes':
            displayNotes(data.data);
            break;
        case 'create_note':
            addMessage(`✅ ${data.message}`, 'bot');
            if (data.data) displayNoteItem(data.data);
            break;
        case 'get_note':
            displayNoteDetail(data.data);
            break;
        case 'search_notes':
            displayNotes(data.data, `Search results: ${data.message}`);
            break;
        
        case 'list_events':
        case 'list_today':
        case 'list_date':
            displayEvents(data.data, data.message);
            break;
        case 'create_event':
            addMessage(`✅ ${data.message}`, 'bot');
            if (data.data) displayEventItem(data.data);
            break;
        
        case 'confirm_delete_all':
            // Store confirmation data
            pendingConfirmation = {
                type: data.confirmation_type,
                data: data.data
            };
            
            // Show confirmation message
            addMessage(`⚠️ ${data.message}`, 'bot');
            
            // Start listening for confirmation
            startVoiceConfirmation();
            break;
        
        case 'schedule_meet':
            displayMeetInfo(data.data, data.message);
            break;
        case 'send_meet_invite':
            addMessage(`✅ ${data.message}`, 'bot');
            break;
        
        case 'list_files':
        case 'search_files':
            displayFiles(data.data, data.message);
            break;
        case 'show_images':
            displayImageGallery(data.data, data.message);
            break;
        case 'show_image':
            displayFullImage(data.data);
            break;
        case 'view_folder':
            displayFolderContents(data.data);
            break;
        case 'summarize_file':
            displaySummary(data.data);
            break;
        
        case 'draft_summary':
            displaySummaryDraft(data.data, data.message);
            break;
        case 'draft_email':
        case 'refine_draft':
        case 'show_draft':
            displayDraft(data.data, data.message);
            break;
        case 'clear_draft':
            addMessage(`✅ ${data.message}`, 'bot');
            break;
        
        case 'help':
            addMessage(data.message, 'bot', true);
            break;
        
        default:
            if (data.message) addMessage(data.message, 'bot');
    }
}

function displayTasks(data) {
    let html = '<div class="task-list">';
    
    if (data.pending && data.pending.length > 0) {
        html += '<h4>📋 Pending Tasks</h4>';
        data.pending.forEach(task => {
            html += displayTaskItem(task, true);
        });
    }
    
    if (data.completed && data.completed.length > 0) {
        html += '<h4 style="margin-top:15px;">✅ Completed</h4>';
        data.completed.forEach(task => {
            html += displayTaskItem(task, true);
        });
    }
    
    html += '</div>';
    addMessage(html, 'bot', true);
    addMessage(data.message, 'bot');
}

function displayTaskItem(task, returnHtml = false) {
    const html = `
        <div class="task-item">
            <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} 
                   onchange="toggleTask('${task.id}')">
            <div class="task-content">
                <div class="task-title ${task.completed ? 'completed' : ''}">${task.text}</div>
                ${task.due ? `<div class="task-due">Due: ${task.due}</div>` : ''}
            </div>
            <div class="task-actions">
                <button class="task-btn" onclick="deleteTask('${task.id}')">🗑️</button>
            </div>
        </div>
    `;
    
    if (returnHtml) return html;
    addMessage(html, 'bot', true);
}

function displayNotes(notes, title = null) {
    if (!notes || notes.length === 0) {
        addMessage('No notes found', 'bot');
        return;
    }
    
    let html = '<div class="notes-grid">';
    notes.forEach(note => {
        html += `
            <div class="note-card" onclick="viewNote('${note.id}')">
                <div class="note-title">${note.title || 'Untitled'}</div>
                <div class="note-preview">${note.content.substring(0, 100)}${note.content.length > 100 ? '...' : ''}</div>
                <div class="note-date">${new Date(note.updated).toLocaleDateString()}</div>
            </div>
        `;
    });
    html += '</div>';
    
    if (title) addMessage(title, 'bot');
    addMessage(html, 'bot', true);
}

function displayNoteDetail(note) {
    let html = `
        <div style="background: white; padding: 20px; border-radius: 8px;">
            <h3 style="color: #495057; margin-bottom: 10px;">${note.title || 'Untitled'}</h3>
            <div style="color: #6c757d; font-size:0.8rem; margin-bottom:15px;">
                Created: ${new Date(note.created).toLocaleString()}
            </div>
            <div style="color: #495057; line-height:1.6; white-space: pre-wrap;">${note.content}</div>
            <div style="margin-top:20px;">
                <button class="task-btn" onclick="deleteNote('${note.id}')">Delete Note</button>
            </div>
        </div>
    `;
    addMessage(html, 'bot', true);
}

function displayEvents(events, message) {
    addMessage(message, 'bot');
    
    if (!events || events.length === 0) return;
    
    let html = '<div class="event-list">';
    events.forEach(event => {
        html += `
            <div class="event-item">
                <div class="event-time">${event.display_start || event.start}</div>
                <div class="event-details">
                    <div class="event-title">${event.summary}</div>
                    ${event.link ? `<a href="${event.link}" target="_blank" class="event-link">View in Calendar</a>` : ''}
                    ${event.meet_link ? `<br><a href="${event.meet_link}" target="_blank" class="event-link">🔗 Meet Link</a>` : ''}
                </div>
            </div>
        `;
    });
    html += '</div>';
    addMessage(html, 'bot', true);
}

function displayEventItem(event) {
    let html = `
        <div style="background: #f8f9fa; padding: 10px; border-radius: 5px; margin:5px 0;">
            <strong>${event.summary}</strong><br>
            📅 ${event.display_start || event.start}
            ${event.link ? `<br><a href="${event.link}" target="_blank">View in Calendar</a>` : ''}
            ${event.meet_link ? `<br><a href="${event.meet_link}" target="_blank">🔗 Join Meet</a>` : ''}
        </div>
    `;
    addMessage(html, 'bot', true);
}

function displayMeetInfo(data, message) {
    let html = `
        <div class="meet-card">
            <h3>🎥 ${data.title}</h3>
            <p>📅 ${data.date} at ${data.time}</p>
            <div class="meet-link">
                <strong>Meet Link:</strong><br>
                <a href="${data.meet_link}" target="_blank">${data.meet_link}</a>
            </div>
        </div>
    `;
    addMessage(html, 'bot', true);
    if (message) addMessage(message, 'bot');
}

function displayFiles(files, message) {
    addMessage(message, 'bot');
    
    if (!files || files.length === 0) {
        addMessage('No files found', 'bot');
        return;
    }
    
    let html = '<div class="file-list">';
    files.forEach(file => {
        const icon = getFileIcon(file.mimeType);
        const isImage = file.mimeType && file.mimeType.startsWith('image/');
        html += `
            <div class="file-item">
                <div class="file-icon">${icon}</div>
                <div class="file-info">
                    <div class="file-name">${file.name}</div>
                    <div class="file-type">${file.mimeType ? file.mimeType.split('/').pop() : 'unknown'}</div>
                </div>
                <div class="file-actions">
                    ${isImage ? `<button class="file-action-btn" onclick="sendCommand('show image ${file.name}')">View</button>` : ''}
                    <button class="file-action-btn" onclick="sendCommand('summarize ${file.name}')">Summarize</button>
                    <button class="file-action-btn" onclick="sendCommand('draft summary of ${file.name}')">Draft</button>
                </div>
            </div>
        `;
    });
    html += '</div>';
    addMessage(html, 'bot', true);
}

function displayImageGallery(images, message) {
    addMessage(message, 'bot');
    
    if (!images || images.length === 0) return;
    
    let html = '<div class="image-gallery">';
    images.forEach(image => {
        html += `
            <div class="image-card" onclick="sendCommand('show image ${image.name}')">
                <img class="image-thumbnail" src="/api/image/${image.id}" alt="${image.name}">
                <div class="image-info">
                    <div class="image-name">${image.name}</div>
                    <div class="image-size">${new Date(image.modifiedTime).toLocaleDateString()}</div>
                </div>
            </div>
        `;
    });
    html += '</div>';
    addMessage(html, 'bot', true);
}

function displayFullImage(data) {
    let html = `
        <div class="full-image-container">
            <img class="full-image" src="data:${data.mime_type};base64,${data.image_data}" alt="${data.file_name}">
            <h3>${data.file_name}</h3>
            <div class="image-actions">
                <button class="draft-btn draft-btn-primary" onclick="window.open('/api/image/${data.file_id}', '_blank')">Open Full Size</button>
                <button class="draft-btn draft-btn-outline" onclick="sendCommand('draft summary of ${data.file_name}')">Summarize</button>
            </div>
        </div>
    `;
    addMessage(html, 'bot', true);
    addMessage(`✅ ${data.file_name} loaded`, 'bot');
}

function displayFolderContents(data) {
    let html = `
        <div class="folder-view">
            <div class="folder-header">
                <span class="folder-icon">📂</span>
                <span class="folder-title">${data.folder_name}</span>
            </div>
    `;
    
    if (data.images && data.images.length > 0) {
        html += `<div class="folder-section"><h4>🖼️ Images (${data.images.length})</h4>`;
        html += '<div class="image-gallery" style="grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));">';
        data.images.forEach(image => {
            html += `
                <div class="image-card" onclick="sendCommand('show image ${image.name}')">
                    <img class="image-thumbnail" src="/api/image/${image.id}" alt="${image.name}" style="height:80px;">
                    <div class="image-info">
                        <div class="image-name">${image.name.length > 15 ? image.name.substring(0, 12) + '...' : image.name}</div>
                    </div>
                </div>
            `;
        });
        html += '</div></div>';
    }
    
    if (data.other_files && data.other_files.length > 0) {
        html += `<div class="folder-section"><h4>📄 Other Files (${data.other_files.length})</h4>`;
        html += '<div class="file-list">';
        data.other_files.slice(0, 5).forEach(file => {
            html += `
                <div class="file-item" style="padding:5px;">
                    <div class="file-icon">${getFileIcon(file.mimeType)}</div>
                    <div class="file-info">
                        <div class="file-name">${file.name}</div>
                    </div>
                </div>
            `;
        });
        if (data.other_files.length > 5) {
            html += `<div style="text-align:center; padding:5px;">... and ${data.other_files.length - 5} more</div>`;
        }
        html += '</div></div>';
    }
    
    html += '</div>';
    
    addMessage(html, 'bot', true);
    addMessage(`✅ ${data.message}`, 'bot');
}

function displaySummary(data) {
    let html = `
        <div style="background: white; padding: 15px; border-radius: 8px;">
            <h3 style="color: #495057; margin-bottom: 10px;">📌 ${data.file_name}</h3>
            <div style="color: #495057; line-height: 1.6;">${data.summary}</div>
            <div style="margin-top: 15px;">
                <button class="draft-btn draft-btn-primary" onclick="sendCommand('draft summary of ${data.file_name}')">📄 Draft This Summary</button>
            </div>
        </div>
    `;
    addMessage(html, 'bot', true);
}

function displaySummaryDraft(draft, message) {
    if (!draft || !draft.body) return;
    
    currentDraft = draft;
    
    let html = '<div class="draft-editor">';
    html += `<div class="draft-header">`;
    html += `<span class="draft-type summary">📄 Summary Draft</span>`;
    if (draft.has_recipient) {
        html += `<span style="color: #28a745;">✓ Will be sent to recipient</span>`;
    }
    html += `</div>`;
    html += `<div class="draft-subject">📧 ${draft.subject}</div>`;
    
    if (draft.summary) {
        html += `<div class="summary-preview">`;
        html += `<h4>📌 Summary Preview:</h4>`;
        html += `<p>${draft.summary}</p>`;
        html += `</div>`;
    }
    
    html += `<div class="draft-body">${draft.body.replace(/\n/g, '<br>')}</div>`;
    html += `<div class="draft-actions">`;
    
    if (draft.has_recipient) {
        html += `<button class="draft-btn draft-btn-success" onclick="sendCommand('send draft')">📤 Send Now</button>`;
    } else {
        html += `<button class="draft-btn draft-btn-primary" onclick="showModal('recipientsModal')">📧 Add Recipients & Send</button>`;
    }
    
    html += `<button class="draft-btn draft-btn-outline" onclick="sendCommand('make it more formal')">More Formal</button>`;
    html += `<button class="draft-btn draft-btn-outline" onclick="sendCommand('shorten it')">Shorten</button>`;
    html += `<button class="draft-btn draft-btn-secondary" onclick="sendCommand('clear draft')">Clear</button>`;
    html += `</div>`;
    html += '</div>';

    addMessage(html, 'bot', true);
    addMessage(`✅ ${message}`, 'bot');
}

function displayDraft(draft, message) {
    if (!draft || !draft.body) {
        addMessage('No draft exists', 'bot');
        return;
    }

    currentDraft = draft;
    
    let html = '<div class="draft-editor">';
    html += `<div class="draft-header">`;
    html += `<span class="draft-type ${draft.type || 'email'}">📧 Email Draft</span>`;
    html += `</div>`;
    html += `<div class="draft-subject">${draft.subject || 'No Subject'}</div>`;
    html += `<div class="draft-body">${draft.body.replace(/\n/g, '<br>')}</div>`;
    
    if (draft.recipients && draft.recipients.length > 0) {
        html += `<p style="margin-top: 10px; color: #6c757d;">Recipients: ${draft.recipients.join(', ')}</p>`;
    }
    
    html += `<div class="draft-actions">`;
    html += `<button class="draft-btn draft-btn-primary" onclick="showModal('recipientsModal')">📧 Send</button>`;
    html += `<button class="draft-btn draft-btn-outline" onclick="sendCommand('make it more formal')">More Formal</button>`;
    html += `<button class="draft-btn draft-btn-outline" onclick="sendCommand('shorten it')">Shorten</button>`;
    html += `<button class="draft-btn draft-btn-secondary" onclick="sendCommand('clear draft')">Clear</button>`;
    html += `</div>`;
    html += '</div>';

    addMessage(html, 'bot', true);
    if (message) addMessage(message, 'bot');
}

function getFileIcon(mimeType) {
    if (!mimeType) return '📄';
    if (mimeType.includes('document')) return '📄';
    if (mimeType.includes('spreadsheet')) return '📊';
    if (mimeType.includes('presentation')) return '📽️';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('image')) return '🖼️';
    if (mimeType.includes('folder')) return '📁';
    return '📄';
}

function detectMessageCategory(content, sender) {
    if (sender === 'user') return 'all';
    
    const contentStr = content.toString().toLowerCase();
    
    if (contentStr.includes('task') || contentStr.includes('✅ completed') || contentStr.includes('pending tasks')) {
        return 'tasks';
    }
    if (contentStr.includes('note') || contentStr.includes('📝') || contentStr.includes('keep')) {
        return 'notes';
    }
    if (contentStr.includes('event') || contentStr.includes('calendar') || contentStr.includes('📅') || contentStr.includes('today')) {
        return 'calendar';
    }
    if (contentStr.includes('image') || contentStr.includes('🖼️') || contentStr.includes('gallery') || contentStr.includes('jpg') || contentStr.includes('png')) {
        return 'images';
    }
    
    return 'all';
}

function addMessage(content, sender, isHtml = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    
    const category = detectMessageCategory(content, sender);
    messageDiv.setAttribute('data-category', category);
    messageDiv.setAttribute('data-sender', sender);
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    if (isHtml) {
        contentDiv.innerHTML = content;
    } else {
        contentDiv.style.whiteSpace = 'pre-wrap';
        contentDiv.textContent = content;
    }
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    timeDiv.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    messageDiv.appendChild(contentDiv);
    messageDiv.appendChild(timeDiv);
    chatArea.appendChild(messageDiv);
    
    messageHistory.push({
        element: messageDiv,
        category: category,
        sender: sender,
        content: content,
        isHtml: isHtml,
        time: timeDiv.textContent
    });
    
    chatArea.scrollTop = chatArea.scrollHeight;
    filterMessagesByTab(activeTab);
}

function addLoadingMessage() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot-message loading-message';
    messageDiv.innerHTML = '<div class="message-content"><div class="loading"></div></div>';
    chatArea.appendChild(messageDiv);
}

function removeLoadingMessage() {
    const loadingMsg = document.querySelector('.loading-message');
    if (loadingMsg) loadingMsg.remove();
}

function filterMessagesByTab(tab) {
    const messages = document.querySelectorAll('.message');
    
    messages.forEach(msg => {
        const category = msg.getAttribute('data-category');
        const sender = msg.getAttribute('data-sender');
        
        if (tab === 'all') {
            msg.style.display = 'block';
        } else if (category === tab || sender === 'user') {
            msg.style.display = 'block';
        } else {
            msg.style.display = 'none';
        }
    });
}

function switchTab(tab) {
    activeTab = tab;
    
    // Update active class on filter options
    document.querySelectorAll('.filter-option').forEach(opt => {
        if (opt.getAttribute('data-tab') === tab) {
            opt.classList.add('active');
        } else {
            opt.classList.remove('active');
        }
    });
    
    filterMessagesByTab(tab);
    
    if (tab !== 'all') {
        showTemporaryMessage(`Showing ${tab} only`);
    }
    
    // Close filter dropdown after selection
    const filterDropdown = document.getElementById('filterDropdown');
    if (filterDropdown) {
        filterDropdown.classList.remove('show');
    }
}

function showTemporaryMessage(text) {
    const existing = document.querySelector('.temp-message');
    if (existing) existing.remove();
    
    const tempDiv = document.createElement('div');
    tempDiv.className = 'temp-message';
    tempDiv.textContent = text;
    
    document.body.appendChild(tempDiv);
    
    setTimeout(() => {
        tempDiv.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => tempDiv.remove(), 300);
    }, 2000);
}

// ========== DROPDOWN FUNCTIONS ==========
function toggleDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    
    // Close any other open dropdowns
    const otherDropdowns = document.querySelectorAll('.dropdown-content.show');
    otherDropdowns.forEach(d => {
        if (d.id !== dropdownId) {
            d.classList.remove('show');
        }
    });
    
    // Toggle current dropdown
    dropdown.classList.toggle('show');
    
    // Load friends when friends dropdown opens
    if (dropdownId === 'friendsDropdown' && dropdown.classList.contains('show')) {
        loadFriendsMini();
    }
    
    // Load agents when agents dropdown opens
    if (dropdownId === 'agentsDropdown' && dropdown.classList.contains('show')) {
        loadAgentsMini();
    }
}

// ========== USER MENU FUNCTIONS ==========
function toggleUserMenu() {
    const dropdown = document.getElementById('userDropdown');
    dropdown.classList.toggle('show');
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(event) {
    const friendsDropdown = document.getElementById('friendsDropdown');
    const agentsDropdown = document.getElementById('agentsDropdown');
    const quickActionsDropdown = document.getElementById('quickActionsDropdown');
    const userDropdown = document.getElementById('userDropdown');
    
    const friendsBtn = document.querySelector('.friends-btn');
    const agentsBtn = document.querySelector('.agents-btn');
    const quickActionsBtn = document.querySelector('.quick-actions-btn');
    const userMenuBtn = document.querySelector('.user-menu-btn');
    
    // Close friends dropdown if clicking outside
    if (friendsBtn && !friendsBtn.contains(event.target) && 
        friendsDropdown && friendsDropdown.classList.contains('show')) {
        friendsDropdown.classList.remove('show');
    }
    
    // Close agents dropdown if clicking outside
    if (agentsBtn && !agentsBtn.contains(event.target) && 
        agentsDropdown && agentsDropdown.classList.contains('show')) {
        agentsDropdown.classList.remove('show');
    }
    
    // Close quick actions dropdown if clicking outside
    if (quickActionsBtn && !quickActionsBtn.contains(event.target) && 
        quickActionsDropdown && quickActionsDropdown.classList.contains('show')) {
        quickActionsDropdown.classList.remove('show');
    }
    
    // Close user dropdown if clicking outside
    if (userMenuBtn && !userMenuBtn.contains(event.target) && 
        userDropdown && userDropdown.classList.contains('show')) {
        userDropdown.classList.remove('show');
    }
});

// ========== FRIENDS FUNCTIONS ==========

function loadFriendsMini() {
    const friendsList = document.getElementById('friendsListMini');
    if (!friendsList) return;
    
    fetch('/api/friends')
        .then(res => res.json())
        .then(data => {
            if (data.success && data.data && data.data.length > 0) {
                let html = '';
                data.data.slice(0, 5).forEach(friend => {
                    const friendId = friend._id || friend.id;
                    // Escape single quotes in name for onclick
                    const escapedName = friend.name.replace(/'/g, "\\'");
                    html += `
                        <div class="friend-item-mini" onclick="quickFriendCommand('${escapedName}')">
                            <div>
                                <div class="friend-name-mini">${friend.name}</div>
                                <div class="friend-email-mini">${friend.email}</div>
                            </div>
                            <i class="fas fa-paper-plane" style="color: #667eea; font-size: 0.8rem;"></i>
                        </div>
                    `;
                });
                if (data.data.length > 5) {
                    html += `<div style="text-align: center; padding: 8px; color: #667eea; font-size: 0.8rem; cursor: pointer;" onclick="showFriendsModal(); return false;">+${data.data.length - 5} more</div>`;
                }
                friendsList.innerHTML = html;
            } else {
                friendsList.innerHTML = '<div style="padding: 10px; color: #6c757d; text-align: center;">No friends yet</div>';
            }
        })
        .catch(err => {
            console.error('Error loading friends:', err);
            friendsList.innerHTML = '<div style="padding: 10px; color: #dc3545; text-align: center;">Error loading friends</div>';
        });
}

function quickFriendCommand(name) {
    commandInput.value = `send email to ${name}`;
    commandInput.focus();
    document.getElementById('friendsDropdown').classList.remove('show');
}

function showFriendsModal() {
    loadFriends();
    showModal('friendsModal');
    document.getElementById('friendsDropdown').classList.remove('show');
}

function loadFriends() {
    const friendsList = document.getElementById('friendsList');
    if (!friendsList) return;
    
    friendsList.innerHTML = '<div style="text-align: center; color: #6c757d; padding: 20px;">Loading...</div>';
    
    fetch('/api/friends')
        .then(res => res.json())
        .then(data => {
            if (data.success && data.data) {
                displayFriends(data.data);
            } else {
                friendsList.innerHTML = '<div class="no-friends">No friends added yet</div>';
            }
        })
        .catch(err => {
            console.error('Error loading friends:', err);
            friendsList.innerHTML = '<div style="color: #dc3545; text-align: center;">Error loading friends</div>';
        });
}

function displayFriends(friends) {
    const friendsList = document.getElementById('friendsList');
    
    if (!friends || friends.length === 0) {
        friendsList.innerHTML = '<div class="no-friends">No friends added yet. Add your first friend above!</div>';
        return;
    }
    
    let html = '';
    friends.forEach(friend => {
        const friendId = friend._id || friend.id;
        html += `
            <div class="friend-item" data-id="${friendId}">
                <div class="friend-info">
                    <div class="friend-name">${friend.name}</div>
                    <div class="friend-email">${friend.email}</div>
                </div>
                <div class="friend-actions">
                    <button class="friend-edit-btn" onclick="editFriend('${friendId}', '${friend.name.replace(/'/g, "\\'")}', '${friend.email}')">Edit</button>
                    <button class="friend-delete-btn" onclick="deleteFriend('${friendId}', '${friend.name.replace(/'/g, "\\'")}')">Delete</button>
                </div>
            </div>
        `;
    });
    
    friendsList.innerHTML = html;
}

function addFriend() {
    const name = document.getElementById('friendName').value.trim();
    const email = document.getElementById('friendEmail').value.trim();
    
    if (!name || !email) {
        alert('Please enter both name and email');
        return;
    }
    
    if (!email.includes('@') || !email.includes('.')) {
        alert('Please enter a valid email address');
        return;
    }
    
    fetch('/api/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            document.getElementById('friendName').value = '';
            document.getElementById('friendEmail').value = '';
            loadFriends();
            loadFriendsMini();
            addSystemMessage(`✅ ${data.message}`);
        } else {
            alert(data.message || 'Error adding friend');
        }
    })
    .catch(err => {
        console.error('Error adding friend:', err);
        alert('Error adding friend');
    });
}

function editFriend(id, currentName, currentEmail) {
    const newName = prompt('Enter new name:', currentName);
    if (newName === null) return;
    
    const newEmail = prompt('Enter new email:', currentEmail);
    if (newEmail === null) return;
    
    fetch(`/api/friends/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, email: newEmail })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            loadFriends();
            loadFriendsMini();
            addSystemMessage(`✅ ${data.message}`);
        } else {
            alert(data.message || 'Error updating friend');
        }
    })
    .catch(err => {
        console.error('Error updating friend:', err);
        alert('Error updating friend');
    });
}

function deleteFriend(id, name) {
    if (!confirm(`Are you sure you want to delete ${name} from your friends?`)) {
        return;
    }
    
    fetch(`/api/friends/${id}`, {
        method: 'DELETE'
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            loadFriends();
            loadFriendsMini();
            addSystemMessage(`✅ ${data.message}`);
        } else {
            alert(data.message || 'Error deleting friend');
        }
    })
    .catch(err => {
        console.error('Error deleting friend:', err);
        alert('Error deleting friend');
    });
}

// ========== AGENTS FUNCTIONS ==========

// ========== AGENTS FUNCTIONS ==========

// Helper function to safely get agent ID from element
function getSafeAgentId(element) {
    if (!element) return null;
    
    // Try to get from data attribute
    let agentId = element.getAttribute('data-agent-id');
    if (agentId) return agentId;
    
    // Try to find parent with data-agent-id
    const parent = element.closest('[data-agent-id]');
    if (parent) {
        return parent.getAttribute('data-agent-id');
    }
    
    return null;
}

// Update your onclick handlers to use this
document.addEventListener('click', function(e) {
    const target = e.target;
    
    if (target.classList.contains('agent-mini-btn')) {
        const agentId = getSafeAgentId(target);
        if (!agentId) {
            console.error('Could not find agent ID for button:', target);
            e.preventDefault();
            return;
        }
        
        const action = target.getAttribute('onclick');
        console.log('Button clicked:', action, 'with agentId:', agentId);
    }
});

function loadAgentsMini() {
    const agentsList = document.getElementById('agentsMiniList');
    if (!agentsList) return;
    
    console.log('🔍 ===== LOADING AGENTS MINI =====');
    
    fetch('/api/agents')
        .then(res => res.json())
        .then(data => {
            console.log('📦 API Response:', JSON.stringify(data, null, 2));
            
            if (data.success && data.data && data.data.length > 0) {
                console.log('📋 Agents count:', data.data.length);
                
                let html = '';
                data.data.slice(0, 3).forEach((agent, index) => {
                    // Log each agent in detail
                    console.log(`\n🔍 Agent ${index + 1}:`, agent);
                    console.log(`   _id:`, agent._id);
                    console.log(`   _id type:`, typeof agent._id);
                    console.log(`   id:`, agent.id);
                    console.log(`   name:`, agent.name);
                    console.log(`   status:`, agent.status);
                    
                    // CRITICAL: Get the ID and ensure it's a string
                    let agentId = agent._id || agent.id;
                    
                    if (!agentId) {
                        console.error('❌ No ID found for agent:', agent);
                        return;
                    }
                    
                    // Force to string and trim
                    agentId = String(agentId).trim();
                    
                    // Log the final ID
                    console.log(`   ✅ Using agentId: "${agentId}" (length: ${agentId.length})`);
                    
                    const statusClass = agent.status === 'active' ? 'status-active' : 
                                      agent.status === 'paused' ? 'status-paused' : 'status-terminated';
                    
                    // Create a test button that logs what would be sent
                    html += `
                        <div class="agent-mini-item" data-agent-id="${agentId}" data-agent-status="${agent.status}" data-agent-name="${agent.name || 'Unnamed'}">
                            <div>
                                <div class="agent-mini-name">${agent.name || 'Unnamed'}</div>
                                <span class="agent-mini-status ${statusClass}">${agent.status || 'unknown'}</span>
                            </div>
                            <div class="agent-mini-actions">
                                <button class="agent-mini-btn test-pause-btn" title="Test Pause">🔄 Test</button>
                                <button class="agent-mini-btn agent-pause-btn" title="Pause/Activate">
                                    ${agent.status === 'active' ? '⏸️' : '▶️'}
                                </button>
                                <button class="agent-mini-btn agent-terminate-btn" title="Terminate">⏹️</button>
                                <button class="agent-mini-btn agent-delete-btn" title="Delete">🗑️</button>
                            </div>
                        </div>
                    `;
                });
                
                agentsList.innerHTML = html;
                console.log('✅ HTML rendered, attaching event listeners...');
                
                // Attach event listeners
                attachAgentEventListeners();
            } else {
                console.log('📭 No agents found');
                agentsList.innerHTML = '<div style="padding: 10px; color: #6c757d; text-align: center;">No agents yet</div>';
            }
        })
        .catch(err => {
            console.error('❌ Error loading agents:', err);
            agentsList.innerHTML = '<div style="padding: 10px; color: #dc3545; text-align: center;">Error loading agents</div>';
        });
}

function attachAgentEventListeners() {
    // Test button - to see what's happening
    document.querySelectorAll('.test-pause-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const agentItem = this.closest('.agent-mini-item');
            if (!agentItem) return;
            
            const agentId = agentItem.dataset.agentId;
            const agentName = agentItem.dataset.agentName;
            const agentStatus = agentItem.dataset.agentStatus;
            
            console.log('🔍 TEST BUTTON CLICKED:');
            console.log('   agentId from dataset:', agentId);
            console.log('   type:', typeof agentId);
            console.log('   length:', agentId?.length);
            console.log('   value:', JSON.stringify(agentId));
            console.log('   agentName:', agentName);
            console.log('   agentStatus:', agentStatus);
            
            alert(`ID: ${agentId}\nType: ${typeof agentId}\nLength: ${agentId?.length}`);
        });
    });
    
    // Pause/Activate button
    document.querySelectorAll('.agent-pause-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const agentItem = this.closest('.agent-mini-item');
            if (!agentItem) return;
            
            const agentId = agentItem.dataset.agentId;
            const currentStatus = agentItem.dataset.agentStatus;
            
            console.log('🔍 PAUSE/ACTIVATE CLICKED:');
            console.log('   agentId from dataset:', agentId);
            console.log('   type:', typeof agentId);
            console.log('   length:', agentId?.length);
            console.log('   value:', JSON.stringify(agentId));
            console.log('   currentStatus:', currentStatus);
            
            if (!agentId) {
                console.error('❌ No agent ID found');
                alert('Error: No agent ID found');
                return;
            }
            
            // Toggle status
            const newStatus = currentStatus === 'active' ? 'paused' : 'active';
            updateAgentStatus(agentId, newStatus);
        });
    });
    
    // Terminate button
    document.querySelectorAll('.agent-terminate-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const agentItem = this.closest('.agent-mini-item');
            if (!agentItem) return;
            
            const agentId = agentItem.dataset.agentId;
            
            console.log('🔍 TERMINATE CLICKED:');
            console.log('   agentId from dataset:', agentId);
            console.log('   type:', typeof agentId);
            console.log('   value:', JSON.stringify(agentId));
            
            if (!agentId) {
                console.error('❌ No agent ID found');
                alert('Error: No agent ID found');
                return;
            }
            
            updateAgentStatus(agentId, 'terminated');
        });
    });
    
    // Delete button
    document.querySelectorAll('.agent-delete-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const agentItem = this.closest('.agent-mini-item');
            if (!agentItem) return;
            
            const agentId = agentItem.dataset.agentId;
            const agentName = agentItem.dataset.agentName;
            
            console.log('🔍 DELETE CLICKED:');
            console.log('   agentId from dataset:', agentId);
            console.log('   type:', typeof agentId);
            console.log('   value:', JSON.stringify(agentId));
            console.log('   agentName:', agentName);
            
            if (!agentId) {
                console.error('❌ No agent ID found');
                alert('Error: No agent ID found');
                return;
            }
            
            if (confirm(`⚠️ Are you sure you want to permanently delete "${agentName}"?`)) {
                deleteAgent(agentId);
            }
        });
    });
}

function updateAgentStatus(agentId, status) {
    console.log('🔍 UPDATEAGENTSTATUS CALLED:');
    console.log('   agentId received:', agentId);
    console.log('   type:', typeof agentId);
    console.log('   length:', agentId?.length);
    console.log('   status:', status);
    
    // Check if agentId is an object
    if (agentId && typeof agentId === 'object') {
        console.error('❌ agentId is an object!', agentId);
        console.log('   Object keys:', Object.keys(agentId));
        alert('Error: Invalid agent ID format (object received)');
        return;
    }
    
    // Ensure it's a string
    const safeAgentId = String(agentId).trim();
    
    // Validate MongoDB ObjectId format (24 hex characters)
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(safeAgentId);
    
    console.log('   safeAgentId:', safeAgentId);
    console.log('   safeAgentId length:', safeAgentId.length);
    console.log('   isValidObjectId:', isValidObjectId);
    
    if (!isValidObjectId) {
        console.error('❌ Invalid ObjectId format:', safeAgentId);
        alert(`Error: Invalid agent ID format. Expected 24 hex chars, got "${safeAgentId}" (length: ${safeAgentId.length})`);
        return;
    }
    
    // Show loading state
    const agentItem = document.querySelector(`[data-agent-id="${safeAgentId}"]`);
    if (agentItem) {
        agentItem.style.opacity = '0.5';
        agentItem.style.pointerEvents = 'none';
    }
    
    const url = `/api/agents/${safeAgentId}/status`;
    console.log('📤 Fetch URL:', url);
    
    fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: status })
    })
    .then(res => res.json())
    .then(data => {
        console.log('📥 Response:', data);
        if (data.success) {
            showTempMessage(`✅ Agent ${status} successfully`, 'success');
            loadAgentsMini();
        } else {
            alert(data.message || `Failed to ${status} agent`);
            if (agentItem) {
                agentItem.style.opacity = '1';
                agentItem.style.pointerEvents = 'auto';
            }
        }
    })
    .catch(err => {
        console.error('❌ Fetch error:', err);
        alert('Error updating agent status');
        if (agentItem) {
            agentItem.style.opacity = '1';
            agentItem.style.pointerEvents = 'auto';
        }
    });
}

function deleteAgent(agentId) {
    console.log('🔍 DELETEAGENT CALLED:');
    console.log('   agentId received:', agentId);
    console.log('   type:', typeof agentId);
    console.log('   length:', agentId?.length);
    
    // Check if agentId is an object
    if (agentId && typeof agentId === 'object') {
        console.error('❌ agentId is an object!', agentId);
        alert('Error: Invalid agent ID format (object received)');
        return;
    }
    
    // Ensure it's a string
    const safeAgentId = String(agentId).trim();
    
    // Validate MongoDB ObjectId format (24 hex characters)
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(safeAgentId);
    
    console.log('   safeAgentId:', safeAgentId);
    console.log('   safeAgentId length:', safeAgentId.length);
    console.log('   isValidObjectId:', isValidObjectId);
    
    if (!isValidObjectId) {
        console.error('❌ Invalid ObjectId format:', safeAgentId);
        alert(`Error: Invalid agent ID format. Expected 24 hex chars, got "${safeAgentId}" (length: ${safeAgentId.length})`);
        return;
    }
    
    // Show loading state
    const agentItem = document.querySelector(`[data-agent-id="${safeAgentId}"]`);
    if (agentItem) {
        agentItem.style.opacity = '0.5';
        agentItem.style.pointerEvents = 'none';
    }
    
    const url = `/api/agents/${safeAgentId}`;
    console.log('📤 Fetch URL:', url);
    
    fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
        console.log('📥 Response:', data);
        if (data.success) {
            showTempMessage('✅ Agent permanently deleted', 'success');
            loadAgentsMini();
        } else {
            alert(data.message || 'Failed to delete agent');
            if (agentItem) {
                agentItem.style.opacity = '1';
                agentItem.style.pointerEvents = 'auto';
            }
        }
    })
    .catch(err => {
        console.error('❌ Fetch error:', err);
        alert('Error deleting agent');
        if (agentItem) {
            agentItem.style.opacity = '1';
            agentItem.style.pointerEvents = 'auto';
        }
    });
}

function showTempMessage(text, type = 'success') {
    const msgDiv = document.createElement('div');
    msgDiv.className = `temp-message ${type}`;
    msgDiv.textContent = text;
    document.body.appendChild(msgDiv);
    
    setTimeout(() => {
        msgDiv.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => msgDiv.remove(), 300);
    }, 2000);
}

function showCreateAgentModal() {
    document.getElementById('agentDescription').value = '';
    showModal('createAgentModal');
}

function fillExample(num) {
    const examples = [
        "When I get email from venkat, forward it to shashank and sathwik",
        "Every Monday at 10 AM, create task 'Weekly team sync'",
        "When file is added to Drive folder 'Reports', summarize it and email me"
    ];
    document.getElementById('agentDescription').value = examples[num-1];
}

function createAgent() {
    const description = document.getElementById('agentDescription').value;
    if (!description) {
        alert('Please describe your agent');
        return;
    }
    
    fetch('/api/agents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert('✅ Agent created successfully!');
            closeModal('createAgentModal');
            loadAgentsMini();
        } else {
            alert('❌ ' + data.message);
        }
    });
}

// ========== SMART SCHEDULE FUNCTIONS ==========

function showSmartScheduleModal() {
    document.getElementById('meetingTitle').value = '';
    document.getElementById('meetingDuration').value = '60';
    document.getElementById('meetingAttendees').value = '';
    document.getElementById('suggestedTimes').style.display = 'none';
    showModal('smartScheduleModal');
}

function findMeetingTimes() {
    const title = document.getElementById('meetingTitle').value;
    const duration = document.getElementById('meetingDuration').value;
    const attendees = document.getElementById('meetingAttendees').value.split(',').map(e => e.trim()).filter(e => e);
    
    fetch('/api/suggest-meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: title,
            duration: parseInt(duration),
            attendees: attendees
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success && data.suggestions) {
            let html = '';
            data.suggestions.forEach(suggestion => {
                html += `
                    <div class="suggestion-item" onclick="selectMeetingTime('${suggestion.start}')">
                        <i class="far fa-clock"></i> ${suggestion.display}
                    </div>
                `;
            });
            document.getElementById('timeSuggestions').innerHTML = html;
            document.getElementById('suggestedTimes').style.display = 'block';
        } else {
            alert('No suggestions found');
        }
    });
}

function selectMeetingTime(time) {
    alert(`Meeting time selected: ${time}\nYou can now create the event.`);
    closeModal('smartScheduleModal');
}

// ========== MODAL FUNCTIONS ==========

function showModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// ========== TASK FUNCTIONS ==========

function showTaskModal() {
    document.getElementById('taskText').value = '';
    document.getElementById('taskDue').value = '';
    showModal('taskModal');
}

function addTask() {
    const text = document.getElementById('taskText').value;
    const due = document.getElementById('taskDue').value;
    
    let command = `add task: ${text}`;
    if (due) command += ` due: ${due}`;
    
    closeModal('taskModal');
    addMessage(command, 'user');
    sendCommand(command);
}

function toggleTask(taskId) {
    sendCommand(`complete task ${taskId}`);
}

function deleteTask(taskId) {
    if (confirm('Delete this task?')) {
        sendCommand(`delete task ${taskId}`);
    }
}

// ========== NOTE FUNCTIONS ==========

function showNoteModal() {
    document.getElementById('noteTitle').value = '';
    document.getElementById('noteContent').value = '';
    showModal('noteModal');
}

function createNote() {
    const title = document.getElementById('noteTitle').value || 'Untitled';
    const content = document.getElementById('noteContent').value;
    
    const command = `create note: ${title} - ${content}`;
    closeModal('noteModal');
    addMessage(command, 'user');
    sendCommand(command);
}

function showNoteSearchModal() {
    document.getElementById('noteSearchKeyword').value = '';
    showModal('noteSearchModal');
}

function searchNotes() {
    const keyword = document.getElementById('noteSearchKeyword').value;
    closeModal('noteSearchModal');
    sendCommand(`search notes: ${keyword}`);
}

function viewNote(noteId) {
    sendCommand(`get note ${noteId}`);
}

function deleteNote(noteId) {
    if (confirm('Delete this note?')) {
        sendCommand(`delete note ${noteId}`);
    }
}

// ========== EVENT FUNCTIONS ==========

function showEventModal() {
    document.getElementById('eventTitle').value = '';
    document.getElementById('eventDate').value = '';
    document.getElementById('eventTime').value = '';
    showModal('eventModal');
}

function createEvent() {
    const title = document.getElementById('eventTitle').value;
    const date = document.getElementById('eventDate').value;
    const time = document.getElementById('eventTime').value;
    
    let command = `create event: ${title} on ${date}`;
    if (time) command += ` at ${time}`;
    
    closeModal('eventModal');
    addMessage(command, 'user');
    sendCommand(command);
}

// ========== MEET FUNCTIONS ==========

function showMeetModal() {
    document.getElementById('meetTitle').value = '';
    document.getElementById('meetDate').value = '';
    document.getElementById('meetTime').value = '';
    document.getElementById('meetAttendees').value = '';
    showModal('meetModal');
}

function scheduleMeet() {
    const title = document.getElementById('meetTitle').value;
    const date = document.getElementById('meetDate').value;
    const time = document.getElementById('meetTime').value;
    const attendees = document.getElementById('meetAttendees').value;
    
    let command = `schedule meet: ${title} on ${date}`;
    if (time) command += ` at ${time}`;
    if (attendees) command += ` with ${attendees}`;
    
    closeModal('meetModal');
    addMessage(command, 'user');
    sendCommand(command);
}

function showMeetInviteModal() {
    document.getElementById('inviteEmail').value = '';
    document.getElementById('inviteEvent').value = '';
    showModal('meetInviteModal');
}

function sendMeetInvite() {
    const email = document.getElementById('inviteEmail').value;
    const eventTitle = document.getElementById('inviteEvent').value;
    
    let command = `send meet invite to ${email}`;
    if (eventTitle) command += ` for ${eventTitle}`;
    
    closeModal('meetInviteModal');
    addMessage(command, 'user');
    sendCommand(command);
}

// ========== IMAGE FUNCTIONS ==========

function showImageSearchModal() {
    document.getElementById('imageFileName').value = '';
    showModal('imageSearchModal');
}

function searchImage() {
    const fileName = document.getElementById('imageFileName').value;
    if (!fileName) {
        alert('Please enter an image name');
        return;
    }
    closeModal('imageSearchModal');
    sendCommand(`show image ${fileName}`);
}

function showFolderModal() {
    document.getElementById('folderName').value = '';
    showModal('folderModal');
}

function viewFolder() {
    const folderName = document.getElementById('folderName').value;
    if (!folderName) {
        alert('Please enter a folder name');
        return;
    }
    closeModal('folderModal');
    sendCommand(`view folder ${folderName}`);
}

// ========== FILE FUNCTIONS ==========

function showFileSearchModal() {
    document.getElementById('fileKeyword').value = '';
    showModal('fileSearchModal');
}

function searchFiles() {
    const keyword = document.getElementById('fileKeyword').value.trim();
    if (!keyword) {
        alert('Please enter a keyword to search');
        return;
    }
    
    closeModal('fileSearchModal');
    addMessage(`search ${keyword}`, 'user');
    sendCommand(`search ${keyword}`);
}

// ========== DRAFT FUNCTIONS ==========

function showDraftModal() {
    document.getElementById('draftPurpose').value = '';
    document.getElementById('draftRecipient').value = '';
    document.getElementById('draftDetails').value = '';
    showModal('draftModal');
}

function createDraft() {
    const purpose = document.getElementById('draftPurpose').value;
    const recipient = document.getElementById('draftRecipient').value;
    const details = document.getElementById('draftDetails').value;
    const tone = document.getElementById('draftTone').value;

    if (!purpose || !recipient || !details) {
        alert('Please fill in all fields');
        return;
    }

    closeModal('draftModal');
    addLoadingMessage();

    fetch('/api/interactive-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            purpose: purpose,
            recipient_type: recipient,
            details: details,
            tone: tone
        })
    })
    .then(res => res.json())
    .then(data => {
        removeLoadingMessage();
        if (data.success) {
            displayDraft(data.data);
            addMessage('✅ Draft created successfully!', 'bot');
        } else {
            addMessage(`❌ ${data.message}`, 'bot');
        }
    });
}

// ========== SUMMARY FUNCTIONS ==========

function showSummaryModal() {
    document.getElementById('summaryFileName').value = '';
    document.getElementById('fileSearchResults').style.display = 'none';
    showModal('summaryModal');
}

function showSummaryWithEmailModal() {
    document.getElementById('summaryEmailFileName').value = '';
    document.getElementById('summaryEmailRecipient').value = '';
    document.getElementById('fileSearchResultsEmail').style.display = 'none';
    showModal('summaryEmailModal');
}

function searchFilesForSummary() {
    const keyword = document.getElementById('summaryFileName').value;
    if (!keyword) {
        alert('Please enter a filename to search');
        return;
    }

    addLoadingMessage();

    fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: `search ${keyword}` })
    })
    .then(res => res.json())
    .then(data => {
        removeLoadingMessage();
        if (data.success && data.data) {
            displayFileSearchResults(data.data, 'summary');
        } else {
            alert('No files found');
        }
    });
}

function searchFilesForSummaryEmail() {
    const keyword = document.getElementById('summaryEmailFileName').value;
    if (!keyword) {
        alert('Please enter a filename to search');
        return;
    }

    addLoadingMessage();

    fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: `search ${keyword}` })
    })
    .then(res => res.json())
    .then(data => {
        removeLoadingMessage();
        if (data.success && data.data) {
            displayFileSearchResults(data.data, 'email');
        } else {
            alert('No files found');
        }
    });
}

function displayFileSearchResults(files, type) {
    const container = type === 'summary' ? 'fileList' : 'fileListEmail';
    const resultsDiv = type === 'summary' ? 'fileSearchResults' : 'fileSearchResultsEmail';
    
    let html = '';
    files.forEach(file => {
        const icon = getFileIcon(file.mimeType);
        html += `
            <div class="file-option" onclick="selectFile('${file.name.replace(/'/g, "\\'")}', '${type}')">
                <span style="margin-right: 10px;">${icon}</span>
                <span>${file.name}</span>
            </div>
        `;
    });
    
    document.getElementById(container).innerHTML = html;
    document.getElementById(resultsDiv).style.display = 'block';
}

function selectFile(fileName, type) {
    if (type === 'summary') {
        document.getElementById('summaryFileName').value = fileName;
        selectedFile = fileName;
        document.getElementById('fileSearchResults').style.display = 'none';
    } else {
        document.getElementById('summaryEmailFileName').value = fileName;
        selectedFileEmail = fileName;
        document.getElementById('fileSearchResultsEmail').style.display = 'none';
    }
}

function createSummaryDraft() {
    const fileName = document.getElementById('summaryFileName').value || selectedFile;
    if (!fileName) {
        alert('Please enter or select a filename');
        return;
    }

    closeModal('summaryModal');
    sendCommand(`draft summary of ${fileName}`);
}

function createAndSendSummary() {
    const fileName = document.getElementById('summaryEmailFileName').value || selectedFileEmail;
    const email = document.getElementById('summaryEmailRecipient').value;

    if (!fileName) {
        alert('Please enter or select a filename');
        return;
    }

    if (!email) {
        alert('Please enter a recipient email');
        return;
    }

    closeModal('summaryEmailModal');
    sendCommand(`draft summary of ${fileName} to ${email}`);
}

// ========== RECIPIENT FUNCTIONS ==========

function sendWithRecipients() {
    const recipients = document.getElementById('recipientsInput').value
        .split(',')
        .map(email => email.trim())
        .filter(email => email);

    if (recipients.length === 0) {
        alert('Please enter at least one email address');
        return;
    }

    closeModal('recipientsModal');
    addLoadingMessage();

    fetch('/api/send-with-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: recipients })
    })
    .then(res => res.json())
    .then(data => {
        removeLoadingMessage();
        if (data.success) {
            addMessage(`✅ ${data.message}`, 'bot');
        } else {
            addMessage(`❌ ${data.message}`, 'bot');
        }
    });
}

// Initialize
function init() {
    // Initialize voice connection
    initVoiceConnection();
    
    // Check if services are initialized
    fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'help' })
    })
    .then(res => res.json())
    .then(data => {
        if (!data.success) {
            addMessage('⚠️ ' + data.message, 'bot');
        }
    });
    
    // Set All as active by default
    setTimeout(() => {
        document.querySelectorAll('.filter-option').forEach(opt => {
            if (opt.getAttribute('data-tab') === 'all') {
                opt.classList.add('active');
            }
        });
    }, 500);
    
    // Load initial data
    loadFriendsMini();
    loadAgentsMini();
}

// Start the application
init();

// Add CSS for agent mini items if not present
const style = document.createElement('style');
style.textContent = `
    .agent-mini-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px;
        border-bottom: 1px solid #f1f3f5;
        transition: opacity 0.3s;
    }
    .agent-mini-item:hover {
        background: #f8f9fa;
    }
    .agent-mini-name {
        font-weight: 500;
        color: #495057;
        font-size: 0.9rem;
    }
    .agent-mini-status {
        font-size: 0.7rem;
        padding: 2px 6px;
        border-radius: 10px;
        display: inline-block;
        margin-top: 2px;
    }
    .agent-mini-actions {
        display: flex;
        gap: 5px;
    }
    .agent-mini-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: background 0.2s;
    }
    .agent-mini-btn:hover {
        background: #e9ecef;
    }
    .status-active {
        background: #d4edda;
        color: #155724;
    }
    .status-paused {
        background: #fff3cd;
        color: #856404;
    }
    .status-terminated {
        background: #f8d7da;
        color: #721c24;
    }
`;
document.head.appendChild(style);