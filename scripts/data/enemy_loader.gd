extends Node

## 敵データローダー
## enemies.jsonを読み込み、敵のデータを管理する

# 敵データの辞書（enemyId -> EnemyData）
var enemies: Dictionary = {}

# 敵データクラス
class EnemyData:
	var enemy_id: String
	var name: String
	var category: String
	var region: String
	var level: int
	var hp: int
	var attack: int
	var defense: int
	var exp: int
	var drop: String
	var spawn_weight: int
	var ai_types: Array
	var element: String
	var weaknesses: Array
	var corruption_level: int
	var description: String
	
	func _init(data: Dictionary):
		enemy_id = data.get("enemyId", "")
		name = data.get("name", "")
		category = data.get("category", "")
		region = data.get("region", "")
		level = data.get("level", 1)
		hp = data.get("hp", 10)
		attack = data.get("attack", 5)
		defense = data.get("defense", 0)
		exp = data.get("exp", 5)
		drop = data.get("drop", "")
		spawn_weight = data.get("spawnWeight", 10)
		ai_types = data.get("aiType", [])
		element = data.get("element", "無")
		weaknesses = data.get("weakness", [])
		corruption_level = data.get("corruptionLevel", 0)
		description = data.get("description", "")

func _ready():
	load_enemies()

func load_enemies():
	"""敵データを読み込む"""
	var file_path = "res://data/enemies.json"
	
	# ファイルが存在するか確認
	if not FileAccess.file_exists(file_path):
		push_error("敵データファイルが見つかりません: " + file_path)
		return
	
	# JSONファイルを読み込む
	var file = FileAccess.open(file_path, FileAccess.READ)
	if file == null:
		push_error("敵データファイルを開けませんでした")
		return
	
	var json_text = file.get_as_text()
	file.close()
	
	# JSONをパース
	var json = JSON.new()
	var parse_result = json.parse(json_text)
	
	if parse_result != OK:
		push_error("敵データのJSONパースに失敗しました")
		return
	
	var data = json.get_data()
	
	if not data.has("enemies"):
		push_error("敵データに'enemies'キーがありません")
		return
	
	# 敵データを辞書に格納
	for enemy_data in data["enemies"]:
		var enemy = EnemyData.new(enemy_data)
		enemies[enemy.enemy_id] = enemy
	
	print("敵データを読み込みました: %d体" % enemies.size())

func get_enemy(enemy_id: String) -> EnemyData:
	"""敵IDから敵データを取得"""
	if enemies.has(enemy_id):
		return enemies[enemy_id]
	else:
		push_warning("敵ID '%s' が見つかりません" % enemy_id)
		return null

func get_enemies_by_region(region: String) -> Array:
	"""地域名から敵のリストを取得"""
	var result = []
	for enemy in enemies.values():
		if enemy.region == region:
			result.append(enemy)
	return result

func get_enemies_by_category(category: String) -> Array:
	"""分類から敵のリストを取得"""
	var result = []
	for enemy in enemies.values():
		if enemy.category == category:
			result.append(enemy)
	return result

func get_enemies_by_level_range(min_level: int, max_level: int) -> Array:
	"""レベル範囲から敵のリストを取得"""
	var result = []
	for enemy in enemies.values():
		if enemy.level >= min_level and enemy.level <= max_level:
			result.append(enemy)
	return result

func get_random_enemy_from_region(region: String) -> EnemyData:
	"""地域からランダムに敵を選択（出現重みを考慮）"""
	var region_enemies = get_enemies_by_region(region)
	
	if region_enemies.is_empty():
		return null
	
	# 出現重みの合計を計算
	var total_weight = 0
	for enemy in region_enemies:
		total_weight += enemy.spawn_weight
	
	# ランダムに選択
	var random_value = randi() % total_weight
	var current_weight = 0
	
	for enemy in region_enemies:
		current_weight += enemy.spawn_weight
		if random_value < current_weight:
			return enemy
	
	# フォールバック（通常は到達しない）
	return region_enemies[0]
