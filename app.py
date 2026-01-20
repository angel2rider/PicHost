from flask import Flask, render_template_string, send_file, request, make_response
import requests
import io
import os

app = Flask(__name__)

# REPLACE THIS with your actual Render URL
DOMAIN = "https://test-3frv.onrender.com"

@app.route('/ai/<path:prompt>')
def discord_preview(prompt):
    """This route serves the HTML that Discord's crawler reads."""
    clean_display = prompt.replace("-", " ")
    
    # We add a random seed to the image URL to prevent Discord's cache
    # from showing the same image for different prompts.
    image_url = f"{DOMAIN}/render/{prompt}.png?seed={os.urandom(2).hex()}"
    
    html = f'''
    <html>
        <head>
            <title>AI Image Generator</title>
            <meta property="og:title" content="Prompt: {clean_display}">
            <meta property="og:description" content="Generated via Pollinations.ai">
            <meta property="og:image" content="{image_url}">
            <meta property="og:image:type" content="image/png">
            <meta property="og:image:width" content="512">
            <meta property="og:image:height" content="512">
            <meta name="twitter:card" content="summary_large_image">
        </head>
        <body>
            <h1>Processing: {clean_display}</h1>
            <p>If you see a grey poop emoji in Discord, try a new link with a different prompt.</p>
        </body>
    </html>
    '''
    return render_template_string(html)

@app.route('/render/<path:prompt>.png')
def generate_image(prompt):
    """This route actually fetches the image from the AI engine."""
    clean_prompt = prompt.replace(".png", "").replace("-", " ")
    
    # We use 512x512 to make it generate FASTER so Discord doesn't timeout.
    poll_url = f"https://image.pollinations.ai/prompt/{clean_prompt}?nologo=true&width=512&height=512"
    
    try:
        # We set a strict timeout of 8 seconds. 
        # Discord usually dies at 10 seconds.
        r = requests.get(poll_url, timeout=8)
        
        if r.status_code == 200:
            # We use make_response to ensure the mimetype is strictly image/png
            response = make_response(send_file(io.BytesIO(r.content), mimetype='image/png'))
            response.headers['Content-Type'] = 'image/png'
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            return response
        else:
            return "AI Engine Error", 500
            
    except requests.exceptions.Timeout:
        return "Image generation took too long for Discord", 408
    except Exception as e:
        return str(e), 500

if __name__ == "__main__":
    # Render requires the app to listen on 0.0.0.0 and a dynamic PORT
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
