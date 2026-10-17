extends Node2D

## ワールドマップ管理スクリプト
## プレイヤー、カメラ、地域判定などを統合管理

@onready var player = $Player
@onready var camera = $GameCamera
@onready var region_name_display = $UILayer/RegionNameDisplay
@onready var regions = $Regions

func _ready():
	# カメラのターゲットをプレイヤーに設定
	if camera:
		camera.target = player
	
	# すべての地域判定エリアのシグナルを接続
	connect_region_signals()
	
	print("ワールドマップが初期化されました")
	print("操作方法: WASD=移動, Shift=ダッシュ")

func connect_region_signals():
	"""すべての地域判定エリアにシグナルを接続"""
	if not regions:
		return
	
	for region in regions.get_children():
		if region is Area2D and region.has_signal("player_entered_region"):
			region.player_entered_region.connect(_on_player_entered_region)
			region.player_exited_region.connect(_on_player_exited_region)

func _on_player_entered_region(region_name: String, subtitle: String):
	"""プレイヤーが地域に入ったときの処理"""
	if region_name_display:
		region_name_display.show_region_name(region_name, subtitle)
	
	# 地域に入ったときの追加処理
	handle_region_entry(region_name)

func _on_player_exited_region():
	"""プレイヤーが地域から出たときの処理"""
	# 特に何もしない（次の地域に入るまで）
	pass

func handle_region_entry(region_name: String):
	"""地域固有の処理"""
	match region_name:
		"ティウム":
			# 音楽変更、敵のスポーン設定などを後で追加
			pass
		"ルナエビーナ":
			# 神秘的な音楽に変更
			pass
		"レギーア":
			# 王都の音楽に変更
			pass
		_:
			pass
