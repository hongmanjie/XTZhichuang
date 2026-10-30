"""CPU background removal using the local U2NETP model; no network access."""
import sys
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageChops, ImageOps

Image.MAX_IMAGE_PIXELS = 40_000_000
source_path, output_path, model_path = sys.argv[1:4]
with Image.open(source_path) as original:
    image = ImageOps.exif_transpose(original).convert('RGBA')
if image.width * image.height > 40_000_000 or max(image.size) > 8192:
    raise ValueError('图片尺寸过大')

rgb = image.convert('RGB')
pixels = np.asarray(rgb.resize((320, 320), Image.Resampling.LANCZOS), dtype=np.float32)
pixels /= max(float(pixels.max()), 1e-6)
pixels = (pixels - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
tensor = np.transpose(pixels, (2, 0, 1))[None, ...]
options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1
session = ort.InferenceSession(model_path, sess_options=options, providers=['CPUExecutionProvider'])
prediction = session.run(None, {session.get_inputs()[0].name: tensor})[0][0, 0]
if not np.isfinite(prediction).all():
    raise ValueError('抠图模型返回无效结果')
low, high = float(prediction.min()), float(prediction.max())
if high - low < 1e-6:
    raise ValueError('抠图模型未识别出有效主体')
mask = Image.fromarray(((prediction - low) / (high - low) * 255).astype('uint8'), mode='L')
mask = mask.resize(image.size, Image.Resampling.LANCZOS)
image.putalpha(ImageChops.multiply(image.getchannel('A'), mask))
image.save(output_path, 'PNG')
