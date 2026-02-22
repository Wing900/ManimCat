/**
 * Manim 代码模板库
 * 常见数学可视化的预构建模板
 */

export type { TemplateMapping } from './manim-templates/types'

export { isLikelyLatex, cleanLatex, generateLatexSceneCode } from './manim-templates/latex'

export {
  generatePythagoreanCode,
  generateDerivativeCode,
  generateIntegralCode
} from './manim-templates/generators-core'

export {
  generate3DSurfaceCode,
  generateSphereCode,
  generateCubeCode
} from './manim-templates/generators-spatial'

export {
  generateMatrixCode,
  generateEigenvalueCode,
  generateComplexCode
} from './manim-templates/generators-linear-algebra'

export {
  generateDiffEqCode,
  generateTrigCode,
  generateQuadraticCode,
  generateBasicVisualizationCode
} from './manim-templates/generators-analysis'

export { templateMappings } from './manim-templates/mappings'

export {
  TEMPLATE_MATCH_THRESHOLD,
  calculateMatchScore,
  selectTemplate,
  getTemplateMatchInfo
} from './manim-templates/selector'
