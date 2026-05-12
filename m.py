import requests, base64
from PIL import Image
from io import BytesIO

def generate_image(prompt, steps=12, guidance_scale=7.5, negative_prompt="low quality, blurry"):
    resp = requests.post(
        "http://142.127.68.223:15069/generate",
        headers={"X-API-KEY": "PRO_SAFETY_TOKEN_2026"},
        data={
            "prompt": prompt,
            "steps": steps,
            "guidance_scale": guidance_scale,
            "negative_prompt": negative_prompt
        },
        timeout=60
    )
    if resp.status_code != 200:
        raise Exception(f"Image generation failed: {resp.text}")
    data = resp.json()
    img_bytes = base64.b64decode(data["image_base64"])
    return Image.open(BytesIO(img_bytes))


image = generate_image("cat on moon")
image.show()  
#image.save("robot.png")