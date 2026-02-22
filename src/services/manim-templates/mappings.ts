import type { TemplateMapping } from './types'
import {
  generateDerivativeCode,
  generateIntegralCode,
  generatePythagoreanCode
} from './generators-core'
import { generate3DSurfaceCode, generateCubeCode, generateSphereCode } from './generators-spatial'
import {
  generateComplexCode,
  generateEigenvalueCode,
  generateMatrixCode
} from './generators-linear-algebra'
import {
  generateDiffEqCode,
  generateQuadraticCode,
  generateTrigCode
} from './generators-analysis'

/**
 * 模板映射（关键词和生成器）
 */
export const templateMappings: Record<string, TemplateMapping> = {
  pythagorean: {
    keywords: ['pythagoras', 'pythagorean', 'right triangle', 'hypotenuse'],
    generator: generatePythagoreanCode
  },
  quadratic: {
    keywords: ['quadratic', 'parabola', 'x squared', 'x^2'],
    generator: generateQuadraticCode
  },
  trigonometry: {
    keywords: ['sine', 'cosine', 'trigonometry', 'trig', 'unit circle'],
    generator: generateTrigCode
  },
  '3d_surface': {
    keywords: ['3d surface', 'surface plot', '3d plot', 'three dimensional'],
    generator: generate3DSurfaceCode
  },
  sphere: {
    keywords: ['sphere', 'ball', 'spherical'],
    generator: generateSphereCode
  },
  cube: {
    keywords: ['cube', 'cubic', 'box'],
    generator: generateCubeCode
  },
  derivative: {
    keywords: ['derivative', 'differentiation', 'slope', 'rate of change'],
    generator: generateDerivativeCode
  },
  integral: {
    keywords: ['integration', 'integral', 'area under curve', 'antiderivative'],
    generator: generateIntegralCode
  },
  matrix: {
    keywords: ['matrix', 'matrices', 'linear transformation'],
    generator: generateMatrixCode
  },
  eigenvalue: {
    keywords: ['eigenvalue', 'eigenvector', 'characteristic'],
    generator: generateEigenvalueCode
  },
  complex: {
    keywords: ['complex', 'imaginary', 'complex plane'],
    generator: generateComplexCode
  },
  differential_equation: {
    keywords: ['differential equation', 'ode', 'pde'],
    generator: generateDiffEqCode
  }
}
