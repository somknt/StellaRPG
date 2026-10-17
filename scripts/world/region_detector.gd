extends Area2D

## 地域判定エリア
## プレイヤーが入った時に地域名を表示する

@export var region_name: String = "地域名"  # 地域の正式名称
@export var region_subtitle: String = ""  # サブタイトル（例：「始まりの村」）

signal player_entered_region(region_name: String, subtitle: String)
signal player_exited_region

func _ready():
	# プレイヤーレイヤーのみを検出
	collision_layer = 0
	collision_mask = 1  # レイヤー1（Player）

	# シグナル接続
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)

func _on_body_entered(body: Node2D):
	if body.is_in_group("player"):
		player_entered_region.emit(region_name, region_subtitle)
		print("プレイヤーが「%s」に入りました" % region_name)

func _on_body_exited(body: Node2D):
	if body.is_in_group("player"):
		player_exited_region.emit()
		print("プレイヤーが「%s」から出ました" % region_name)
