extends Camera2D

## カメラコントローラー
## プレイヤーを追従し、スムーズなスクロールを実現

@export var target: Node2D  # 追従対象（プレイヤー）
@export var smoothness: float = 5.0  # カメラの追従の滑らかさ
@export var zoom_min: float = 1.0  # 最小ズーム
@export var zoom_max: float = 2.0  # 最大ズーム
@export var zoom_speed: float = 0.1  # ズーム速度

# マップの境界（タイル単位）
@export var map_bounds: Rect2 = Rect2(0, 0, 6400, 4800)

var current_zoom: float = 1.5

func _ready():
	# 初期ズーム設定
	zoom = Vector2(current_zoom, current_zoom)
	
	# カメラリミット設定
	limit_left = int(map_bounds.position.x)
	limit_top = int(map_bounds.position.y)
	limit_right = int(map_bounds.position.x + map_bounds.size.x)
	limit_bottom = int(map_bounds.position.y + map_bounds.size.y)
	
	# スムージング有効化
	position_smoothing_enabled = true
	position_smoothing_speed = smoothness

func _process(_delta):
	# ターゲットが設定されている場合は追従
	if target:
		global_position = target.global_position
	
	# ズーム操作（マウスホイール）
	handle_zoom_input()

func handle_zoom_input():
	"""ズーム入力を処理"""
	if Input.is_action_just_released("ui_page_up"):  # ズームイン
		change_zoom(zoom_speed)
	elif Input.is_action_just_released("ui_page_down"):  # ズームアウト
		change_zoom(-zoom_speed)

func change_zoom(amount: float):
	"""ズームを変更"""
	current_zoom += amount
	current_zoom = clamp(current_zoom, zoom_min, zoom_max)
	
	# スムーズにズーム
	var tween = create_tween()
	tween.tween_property(self, "zoom", Vector2(current_zoom, current_zoom), 0.2)
