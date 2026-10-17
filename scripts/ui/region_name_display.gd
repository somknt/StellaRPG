extends Control

## 地域名表示UI
## プレイヤーが地域に入ったときに地域名を表示

@onready var region_label: Label = $MarginContainer/VBoxContainer/RegionName
@onready var subtitle_label: Label = $MarginContainer/VBoxContainer/Subtitle
@onready var animation_player: AnimationPlayer = $AnimationPlayer

var display_duration: float = 2.0
var is_displaying: bool = false

func _ready():
	# 初期状態では非表示
	modulate.a = 0.0

func show_region_name(region_name: String, subtitle: String = ""):
	"""地域名を表示"""
	if is_displaying:
		# すでに表示中の場合は一旦非表示にしてから再表示
		hide_region_name()
		await get_tree().create_timer(0.1).timeout
	
	# テキスト設定
	region_label.text = region_name
	subtitle_label.text = subtitle
	subtitle_label.visible = subtitle != ""
	
	# フェードイン
	is_displaying = true
	var tween = create_tween()
	tween.tween_property(self, "modulate:a", 1.0, 0.5)
	
	# 表示時間後にフェードアウト
	await get_tree().create_timer(display_duration).timeout
	hide_region_name()

func hide_region_name():
	"""地域名を非表示"""
	if not is_displaying:
		return
	
	# フェードアウト
	var tween = create_tween()
	tween.tween_property(self, "modulate:a", 0.0, 0.5)
	await tween.finished
	is_displaying = false
