from server.services.video_service import video_service
from server.core.config_manager import CONFIG_PATH
import json

video_service.refresh_config()
cfg = video_service._config
print('CONFIG_PATH:', CONFIG_PATH)
print('GIFT_MAP:', json.dumps(cfg.get('gift_map'), ensure_ascii=False, indent=2))
print('ACTION_MAP:', json.dumps(cfg.get('action_map'), ensure_ascii=False, indent=2))
print('VIDEOS count:', len(cfg.get('videos', [])))
print("get_next_video('gift','Rosa') =>", video_service.get_next_video('gift', 'Rosa'))
print("get_next_video('gift','rosinha') =>", video_service.get_next_video('gift', 'rosinha'))
print("get_next_video('gift','something_unknown') =>", video_service.get_next_video('gift', 'something_unknown'))
