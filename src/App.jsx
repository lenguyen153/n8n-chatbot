import React, { useState, useEffect, useRef } from 'react';

// Helper function to render message content with markdown support for links
const MessageContent = ({ content }) => {
    // A simple regex to find URLs and wrap them in anchor tags
    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    const parts = content.split(urlRegex);
    return (
        <>
            {parts.map((part, index) => {
                if (part && part.match(urlRegex)) {
                    return <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{part}</a>;
                }
                return part;
            })}
        </>
    );
};


// Main Chatbot App Component
const App = () => {
    // State Management
    const [n8nWebhookUrl, setN8nWebhookUrl] = useState('');
    const [chatId, setChatId] = useState(null);
    const [messages, setMessages] = useState([
        { sender: 'bot', text: "Hello! Please enter your n8n Chat Trigger Webhook URL above to begin." }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const chatContainerRef = useRef(null);

    // Automatically scroll to the bottom of the chat on new messages
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages]);

    // Main function to handle sending a message to the n8n webhook
    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        if (!n8nWebhookUrl.trim() || !n8nWebhookUrl.startsWith('http')) {
            setError('Please enter a valid n8n Webhook URL to start chatting.');
            return;
        }
        setError('');

        const userMessage = { sender: 'user', text: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        // Add a placeholder for the bot's response
        setMessages(prev => [...prev, { sender: 'bot', text: '' }]);

        try {
            // Prepare headers. If a chatId exists, send it to maintain conversation context.
            const headers = { 'Content-Type': 'application/json' };
            if (chatId) {
                headers['X-N8N-CHAT-ID'] = chatId;
            }

            // Make the POST request to the n8n webhook
            const response = await fetch(n8nWebhookUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ message: input }),
            });

            // Check for a valid response
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Network response was not ok: ${response.status} ${errorText}`);
            }

            // The n8n chatTrigger returns a chatId in the headers for the first message.
            // We capture it here to use in subsequent requests.
            const newChatId = response.headers.get('X-N8N-CHAT-ID');
            if (newChatId && !chatId) {
                setChatId(newChatId);
            }
            
            // *** UPDATED LOGIC TO HANDLE BOTH STREAMING AND NON-STREAMING RESPONSES ***
            const contentType = response.headers.get("content-type");

            if (contentType && contentType.includes("application/json")) {
                // Handle a single, non-streaming JSON object from n8n
                const data = await response.json();
                if (data.text) {
                     setMessages(prev => {
                        const lastMessage = prev[prev.length - 1];
                        const updatedLastMessage = { ...lastMessage, text: data.text };
                        return [...prev.slice(0, -1), updatedLastMessage];
                    });
                }
            } else {
                // Handle a streaming response (text/event-stream) from n8n
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // Keep the last, possibly incomplete line

                    for (const line of lines) {
                        if (line.trim().startsWith('data:')) {
                            const jsonString = line.trim().substring(5);
                            if (jsonString) {
                                try {
                                    const data = JSON.parse(jsonString);
                                    if (data.text) {
                                        // Append the streamed text to the last bot message
                                        setMessages(prev => {
                                            const lastMessage = prev[prev.length - 1];
                                            const updatedLastMessage = { ...lastMessage, text: lastMessage.text + data.text };
                                            return [...prev.slice(0, -1), updatedLastMessage];
                                        });
                                    }
                                } catch (e) {
                                    console.error('Failed to parse stream data chunk:', jsonString);
                                }
                            }
                        }
                    }
                }
            }

        } catch (err) {
            console.error('Error sending message to n8n:', err);
            
            let userFriendlyError = `Error: ${err.message}. Please check the webhook URL and your n8n workflow.`;
            
            const match = err.message.match(/{.*}/);
            if (match) {
                try {
                    const errorJson = JSON.parse(match[0]);
                    if (errorJson.message) {
                        userFriendlyError = `An error occurred in your n8n workflow: "${errorJson.message}"\n\nCommon issues to check:\n1. Is the workflow active?\n2. Is the API key in your Google Gemini node valid?\n3. Is the model name correct?\n4. Check the workflow execution logs in n8n for more details.`;
                    }
                } catch (e) {
                    console.error("Failed to parse n8n error JSON from string", e);
                }
            }

            setError(userFriendlyError);
             setMessages(prev => {
                const lastMessage = prev[prev.length - 1];
                const updatedLastMessage = { ...lastMessage, text: userFriendlyError, isError: true };
                return [...prev.slice(0, -1), updatedLastMessage];
            });
        } finally {
            setIsLoading(false);
        }
    };
    
    // Function to start a new chat session
    const handleNewChat = () => {
        setChatId(null);
        setMessages([{ sender: 'bot', text: "New chat started. Your conversation history has been cleared." }]);
        setError('');
        setIsLoading(false);
    }

    return (
        <div className="flex flex-col h-screen bg-gray-800 text-white font-sans">
            {/* Header Section */}
            <header className="bg-gray-900 p-4 shadow-md z-10">
                <h1 className="text-xl font-bold text-center text-gray-200">n8n AI Chatbot</h1>
                <div className="mt-4 max-w-2xl mx-auto">
                    <label htmlFor="webhook-url" className="text-sm font-medium text-gray-400">n8n Chat Trigger Webhook URL</label>
                    <input
                        id="webhook-url"
                        type="text"
                        value={n8nWebhookUrl}
                        onChange={(e) => setN8nWebhookUrl(e.target.value)}
                        placeholder="https://your-n8n-instance.com/webhook/..."
                        className="w-full p-2 mt-1 bg-gray-700 border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                </div>
            </header>

            {/* Chat Messages Area */}
            <main ref={chatContainerRef} className="flex-1 p-4 overflow-y-auto">
                <div className="max-w-2xl mx-auto space-y-4">
                    {messages.map((msg, index) => (
                        <div key={index} className={`flex items-end gap-2 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {msg.sender === 'bot' && (
                                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                </div>
                            )}
                            <div className={`px-4 py-2 rounded-2xl max-w-lg ${msg.sender === 'user' ? 'bg-gray-700 rounded-br-none' : `bg-gray-900 rounded-bl-none ${msg.isError ? 'text-red-400' : ''}`}`}>
                                <p className="text-sm whitespace-pre-wrap">
                                   <MessageContent content={msg.text} />
                                   {isLoading && msg.sender === 'bot' && index === messages.length - 1 && (
                                        <span className="inline-block w-1 h-4 bg-gray-400 ml-1 animate-pulse" />
                                   )}
                                </p>
                            </div>
                             {msg.sender === 'user' && (
                                <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center flex-shrink-0">
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </main>

            {/* Input Form Area */}
            <footer className="bg-gray-900 p-4 shadow-up z-10">
                <div className="max-w-2xl mx-auto">
                    {error && <p className="text-red-400 text-sm text-center mb-2 whitespace-pre-wrap">{error}</p>}
                    <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                        <button type="button" onClick={handleNewChat} title="Start New Chat" className="p-2 bg-gray-700 rounded-full hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500">
                           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        </button>
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Type your message..."
                            disabled={isLoading || !n8nWebhookUrl}
                            className="flex-1 p-3 bg-gray-700 border border-gray-600 rounded-full focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-50"
                        />
                        <button type="submit" disabled={isLoading || !input.trim()} className="p-3 bg-blue-600 rounded-full hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500">
                           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                        </button>
                    </form>
                </div>
            </footer>
        </div>
    );
};

export default App;
