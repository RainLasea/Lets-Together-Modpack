var LT_CookingDataComponents = Java.loadClass('net.minecraft.core.component.DataComponents')

ServerEvents.recipes(event => {
  var removedFoodRecipes = 0

  event.forEachRecipe([
    { type: 'minecraft:smelting' },
    { type: 'minecraft:blasting' }
  ], recipe => {
    var result = recipe.getOriginalRecipeResult()
    var category = recipe.json.get('category')
    if (result.get(LT_CookingDataComponents.FOOD) != null ||
        (category != null && category.getAsString() === 'food')) {
      recipe.remove()
      removedFoodRecipes++
    }
  })
})
