extends CharacterBody2D

## プレイヤーキャラクターの移動と基本操作を管理

# ステータス
@export var walk_speed: float = 150.0  # 通常移動速度
@export var dash_speed: float = 250.0  # ダッシュ速度
@export var max_stamina: float = 100.0  # 最大スタミナ
@export var stamina_drain_rate: float = 5.0  # ダッシュ時のスタミナ消費（毎秒）
@export var stamina_recovery_rate: float = 10.0  # スタミナ回復速度（毎秒）

# 現在の状態
var current_stamina: float = 100.0
var is_dashing: bool = false

# アニメーション方向
enum Direction { DOWN, UP, LEFT, RIGHT }
var current_direction: Direction = Direction.DOWN

func _ready():
	# 初期化
	current_stamina = max_stamina

func _physics_process(delta):
	# 入力を取得
	var input_vector = get_input_vector()
	
	# ダッシュ判定
	update_dash_state(delta)
	
	# 速度を設定
	if input_vector != Vector2.ZERO:
		# 移動方向を設定
		update_direction(input_vector)
		
		# 速度を計算
		var speed = dash_speed if is_dashing else walk_speed
		velocity = input_vector * speed
	else:
		# 入力がない場合は減速
		velocity = velocity.move_toward(Vector2.ZERO, walk_speed * delta * 10)
	
	# スタミナ回復（移動していない、またはダッシュしていない場合）
	if not is_dashing:
		recover_stamina(delta)
	
	# 物理演算で移動
	move_and_slide()
	
	# アニメーション更新
	update_animation()

func get_input_vector() -> Vector2:
	"""入力から移動ベクトルを取得"""
	var input_vector = Vector2.ZERO
	input_vector.x = Input.get_action_strength("move_right") - Input.get_action_strength("move_left")
	input_vector.y = Input.get_action_strength("move_down") - Input.get_action_strength("move_up")
	return input_vector.normalized()

func update_dash_state(delta: float):
	"""ダッシュ状態を更新"""
	if Input.is_action_pressed("dash") and current_stamina > 0:
		is_dashing = true
		# スタミナを消費
		current_stamina -= stamina_drain_rate * delta
		current_stamina = max(0, current_stamina)
	else:
		is_dashing = false

func recover_stamina(delta: float):
	"""スタミナを回復"""
	if current_stamina < max_stamina:
		current_stamina += stamina_recovery_rate * delta
		current_stamina = min(max_stamina, current_stamina)

func update_direction(input_vector: Vector2):
	"""入力から向きを更新"""
	# 縦方向の入力が強い場合
	if abs(input_vector.y) > abs(input_vector.x):
		if input_vector.y > 0:
			current_direction = Direction.DOWN
		else:
			current_direction = Direction.UP
	# 横方向の入力が強い場合
	else:
		if input_vector.x > 0:
			current_direction = Direction.RIGHT
		else:
			current_direction = Direction.LEFT

func update_animation():
	"""アニメーションを更新（現在はプレースホルダー）"""
	# TODO: AnimatedSprite2D と連携してアニメーション再生
	# 例: $AnimatedSprite2D.play("walk_down")
	pass

func get_stamina_percentage() -> float:
	"""スタミナの割合を返す（UI表示用）"""
	return current_stamina / max_stamina
