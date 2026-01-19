from flask import Flask, render_template_string, send_file
import requests
import io

app = Flask(__name__)

# IMPORTANT: Change this to your public ngrok or domain URL
DOMAIN = "https://your-unique-id.ngrok-free.app"

@app.route('/ai/<path:prompt>')
def discord_instruction_page(prompt):
    # This part is lightning fast. It tells Discord what the image is.
    clean_display = prompt.replace("-", " ")
    
    html = f'''
    <html>
        <head>
            <title>AI Generator</title>
            <meta property="og:title" content="AI Image: {clean_display}">
            <meta property="og:image" content="{DOMAIN}/render/{prompt}.png">
            <meta property="og:image:type" content="image/png">
            <meta property="og:image:width" content="1024">
            <meta property="og:image:height" content="1024">
            <meta name="twitter:card" content="summary_large_image">
        </head>
        <body>Generating your prompt: {clean_display}</body>
    </html>
    '''
    return render_template_string(html)

@app.route('/render/<path:prompt>.png')
def stream_ai_image(prompt):
    # This is where the 3-5 second generation happens
    clean_prompt = prompt.replace("-", " ")
    print(f"Generating: {clean_prompt}")
    
    poll_url = f"https://image.pollinations.ai/prompt/{clean_prompt}?nologo=true"
    
    try:
        response = requests.get(poll_url, timeout=15)
        return send_file(io.BytesIO(response.content), mimetype='image/png')
    except Exception as e:
        return str(e), 500

if __name__ == "__main__":
    app.run(port=5000)
