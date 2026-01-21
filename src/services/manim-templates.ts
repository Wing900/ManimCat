/**
 * Manim 代码模板库
 * 常见数学可视化的预构建模板
 */

import { createLogger } from '../utils/logger'

const logger = createLogger('ManimTemplates')

export interface TemplateMapping {
  keywords: string[];
  generator: () => string;
}

// 用于检测的 LaTeX 命令模式
const LATEX_COMMAND_HINTS = [
  '\\frac', '\\sum', '\\int', '\\sqrt', '\\alpha', '\\beta',
  '\\pi', '\\sin', '\\cos', '\\tan', '\\left', '\\right',
];

/**
 * 检查文本是否可能是 LaTeX 表达式
 */
export function isLikelyLatex(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  // 检查常见的 LaTeX 分隔符
  if (['$$', '$', '\\(', '\\)', '\\[', '\\]'].some(d => t.includes(d))) {
    return true;
  }

  // 检查 LaTeX 命令
  if (LATEX_COMMAND_HINTS.some(cmd => t.includes(cmd))) {
    return true;
  }

  // 检查上标/下标模式
  if ((t.includes('^') || t.includes('_')) && !t.slice(0, 3).trim().includes(' ')) {
    return true;
  }

  return false;
}

/**
 * 清理 LaTeX 表达式，移除分隔符
 */
export function cleanLatex(text: string): string {
  let t = text.trim();
  // 移除常见的分隔符
  t = t.replace(/^\$+|\$+$/g, '');
  t = t.replace(/^\\\(|\\\)$/g, '');
  t = t.replace(/^\\\[|\\\]$/g, '');
  return t.trim();
}

/**
 * 为 LaTeX 表达式生成 Manim 代码
 */
export function generateLatexSceneCode(expr: string): string {
  const cleanedExpr = cleanLatex(expr);
  return `from manim import *

class MainScene(Scene):
    def construct(self):
        title = Title('LaTeX')
        eq = MathTex(r"${cleanedExpr}").scale(1.2)
        self.play(Write(title))
        self.play(Write(eq))
        self.wait()
`;
}

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
};

/**
 * 计算模板的匹配分数
 * 返回 0 到 1 之间的分数，越高越好
 */
export function calculateMatchScore(concept: string, keywords: string[]): number {
  const lowerConcept = concept.toLowerCase().trim();
  const words = lowerConcept.split(/\s+/);

  let matchedKeywords = 0;
  let totalKeywordWords = 0;

  for (const keyword of keywords) {
    const keywordWords = keyword.toLowerCase().split(/\s+/);
    totalKeywordWords += keywordWords.length;

    const allWordsMatch = keywordWords.every(kw =>
      words.some(w => w.includes(kw) || kw.includes(w))
    );

    if (allWordsMatch) {
      matchedKeywords += keywordWords.length;
    }
  }

  // 计算匹配的关键词单词百分比
  const keywordScore = totalKeywordWords > 0 ? matchedKeywords / totalKeywordWords : 0;

  // 对于复杂查询给予强惩罚（这些查询可能比模板更具体）
  const conceptComplexity = words.length;
  let complexityPenalty = 1.0;

  if (conceptComplexity > 8) {
    complexityPenalty = 0.4;  // 非常复杂的查询 - 60% 惩罚
  } else if (conceptComplexity > 5) {
    complexityPenalty = 0.6;  // 中等复杂度 - 40% 惩罚
  }

  // 如果概念中有不在任何关键词中的单词，给予额外惩罚（可能是特定要求）
  const allKeywordWords = keywords.flatMap(k => k.toLowerCase().split(/\s+/));
  const unmatchedWords = words.filter(w => !allKeywordWords.some(kw => w.includes(kw) || kw.includes(w)));
  const specificityPenalty = unmatchedWords.length > 3 ? 0.8 : 1.0;

  return keywordScore * complexityPenalty * specificityPenalty;
}

/**
 * 模板匹配阈值 - 设置得很高以优先考虑 AI 生成（获得独特的输出）
 * 0.75 要求非常强的关键词匹配才能使用模板
 */
export const TEMPLATE_MATCH_THRESHOLD = 0.75;

/**
 * 根据概念关键词选择合适的模板
 * 只有在置信度非常高（>0.75）时才返回模板
 * 这确保大多数查询会交给 AI 以获得独特的动画
 */
export function selectTemplate(concept: string): { code: string; templateName: string } | null {
  const lowerConcept = concept.toLowerCase().trim();

  let bestMatch: (() => string) | null = null;
  let bestTemplateName = '';
  let bestScore = 0;

  for (const [templateName, templateInfo] of Object.entries(templateMappings)) {
    const score = calculateMatchScore(lowerConcept, templateInfo.keywords);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = templateInfo.generator;
      bestTemplateName = templateName;
    }
  }

  // 只有在置信度非常高（>75% 匹配）时才使用模板
  // 这确保复杂/特定的查询会交给 AI 以获得独特的输出
  if (bestMatch && bestScore > TEMPLATE_MATCH_THRESHOLD) {
    try {
      return { code: bestMatch(), templateName: bestTemplateName };
    } catch (error) {
      logger.error('生成模板时出错', { error });
      return null;
    }
  }

  return null;
}

/**
 * 获取模板匹配信息而不生成代码（用于日志/调试）
 */
export function getTemplateMatchInfo(concept: string): { bestTemplate: string; bestScore: number; threshold: number } {
  const lowerConcept = concept.toLowerCase().trim();
  let bestTemplate = '';
  let bestScore = 0;

  for (const [templateName, templateInfo] of Object.entries(templateMappings)) {
    const score = calculateMatchScore(lowerConcept, templateInfo.keywords);
    if (score > bestScore) {
      bestScore = score;
      bestTemplate = templateName;
    }
  }

  return { bestTemplate, bestScore, threshold: TEMPLATE_MATCH_THRESHOLD };
}

// --- 模板生成器 ---

export function generatePythagoreanCode(): string {
  return `from manim import *

class MainScene(Scene):
    def construct(self):
        # 创建三角形
        triangle = Polygon(
            ORIGIN, RIGHT*3, UP*4,
            color=WHITE
        )

        # 使用 Text 替代 MathTex 添加标签
        a = Text("a", font_size=36).next_to(triangle, DOWN)
        b = Text("b", font_size=36).next_to(triangle, RIGHT)
        c = Text("c", font_size=36).next_to(
            triangle.get_center() + UP + RIGHT,
            UP+RIGHT
        )

        # 使用 MathTex 添加等式
        equation = MathTex(r"a^2 + b^2 = c^2").scale(1.1)
        equation.to_edge(UP)

        # 创建动画
        self.play(Create(triangle))
        self.play(Write(a), Write(b), Write(c))
        self.play(Write(equation))
        self.wait()
`;
}

export function generateDerivativeCode(): string {
  return `from manim import *

class MainScene(Scene):
    def construct(self):
        # 创建坐标系
        axes = Axes(
            x_range=[-2, 2],
            y_range=[-1, 2],
            axis_config={"include_tip": True}
        )

        # 添加自定义标签
        x_label = Text("x").next_to(axes.x_axis.get_end(), RIGHT)
        y_label = Text("y").next_to(axes.y_axis.get_end(), UP)

        # 创建函数
        def func(x):
            return x**2

        graph = axes.plot(func, color=BLUE)

        # 创建导数函数
        def deriv(x):
            return 2*x

        derivative = axes.plot(deriv, color=RED)

        # 创建标签
        func_label = Text("f(x) = x^2").set_color(BLUE)
        deriv_label = Text("f'(x) = 2x").set_color(RED)

        # 定位标签
        func_label.to_corner(UL)
        deriv_label.next_to(func_label, DOWN)

        # 创建动画
        self.play(Create(axes), Write(x_label), Write(y_label))
        self.play(Create(graph), Write(func_label))
        self.wait()
        self.play(Create(derivative), Write(deriv_label))
        self.wait()
`;
}

export function generateIntegralCode(): string {
  return `from manim import *

class MainScene(Scene):
    def construct(self):
        # 创建坐标系
        axes = Axes(
            x_range=[-2, 2],
            y_range=[-1, 2],
            axis_config={"include_tip": True}
        )

        # 添加自定义标签
        x_label = Text("x").next_to(axes.x_axis.get_end(), RIGHT)
        y_label = Text("y").next_to(axes.y_axis.get_end(), UP)

        # 创建函数
        def func(x):
            return x**2

        graph = axes.plot(func, color=BLUE)

        # 创建面积
        area = axes.get_area(
            graph,
            x_range=[0, 1],
            color=YELLOW,
            opacity=0.3
        )

        # 创建标签
        func_label = Text("f(x) = x^2").set_color(BLUE)
        integral_label = Text("Area = 1/3").set_color(YELLOW)

        # 定位标签
        func_label.to_corner(UL)
        integral_label.next_to(func_label, DOWN)

        # 创建动画
        self.play(Create(axes), Write(x_label), Write(y_label))
        self.play(Create(graph), Write(func_label))
        self.wait()
        self.play(FadeIn(area), Write(integral_label))
        self.wait()
`;
}

export function generate3DSurfaceCode(): string {
  return `from manim import *
import numpy as np

class MainScene(ThreeDScene):
    def construct(self):
        # 配置场景
        self.set_camera_orientation(phi=75 * DEGREES, theta=30 * DEGREES)

        # 创建坐标轴
        axes = ThreeDAxes()

        # 创建曲面
        def func(x, y):
            return np.sin(x) * np.cos(y)

        surface = Surface(
            lambda u, v: axes.c2p(u, v, func(u, v)),
            u_range=[-3, 3],
            v_range=[-3, 3],
            resolution=32,
            checkerboard_colors=[BLUE_D, BLUE_E]
        )

        # 添加自定义标签
        x_label = Text("x").next_to(axes.x_axis.get_end(), RIGHT)
        y_label = Text("y").next_to(axes.y_axis.get_end(), UP)
        z_label = Text("z").next_to(axes.z_axis.get_end(), OUT)

        # 创建动画
        self.begin_ambient_camera_rotation(rate=0.2)
        self.play(Create(axes), Write(x_label), Write(y_label), Write(z_label))
        self.play(Create(surface))
        self.wait(2)
        self.stop_ambient_camera_rotation()
        self.wait()
`;
}

export function generateSphereCode(): string {
  return `from manim import *
import numpy as np

class MainScene(ThreeDScene):
    def construct(self):
        # 配置场景
        self.set_camera_orientation(phi=75 * DEGREES, theta=30 * DEGREES)

        # 创建坐标轴
        axes = ThreeDAxes()

        # 创建球体
        sphere = Surface(
            lambda u, v: np.array([
                np.cos(u) * np.cos(v),
                np.cos(u) * np.sin(v),
                np.sin(u)
            ]),
            u_range=[-PI/2, PI/2],
            v_range=[0, TAU],
            checkerboard_colors=[BLUE_D, BLUE_E]
        )

        # 添加自定义标签
        x_label = Text("x").next_to(axes.x_axis.get_end(), RIGHT)
        y_label = Text("y").next_to(axes.y_axis.get_end(), UP)
        z_label = Text("z").next_to(axes.z_axis.get_end(), OUT)

        # 创建动画
        self.begin_ambient_camera_rotation(rate=0.2)
        self.play(Create(axes), Write(x_label), Write(y_label), Write(z_label))
        self.play(Create(sphere))
        self.wait(2)
        self.stop_ambient_camera_rotation()
        self.wait()
`;
}

export function generateCubeCode(): string {
  return `from manim import *

class MainScene(ThreeDScene):
    def construct(self):
        # 设置场景
        self.set_camera_orientation(phi=75 * DEGREES, theta=30 * DEGREES)
        axes = ThreeDAxes(
            x_range=[-3, 3],
            y_range=[-3, 3],
            z_range=[-3, 3]
        )

        # 创建立方体
        cube = Cube(side_length=2, fill_opacity=0.7, stroke_width=2)
        cube.set_color(BLUE)

        # 面的标签
        a_label = Text("a", font_size=36).set_color(YELLOW)
        a_label.next_to(cube, RIGHT)

        # 表面积公式
        area_formula = Text(
            "A = 6a^2"
        ).to_corner(UL)

        # 将所有内容添加到场景
        self.add(axes)
        self.play(Create(cube))
        self.wait()
        self.play(Write(a_label))
        self.wait()
        self.play(Write(area_formula))
        self.wait()

        # 旋转相机以获得更好的视角
        self.begin_ambient_camera_rotation(rate=0.2)
        self.wait(5)
        self.stop_ambient_camera_rotation()
`;
}

export function generateMatrixCode(): string {
  return `from manim import *

class MainScene(Scene):
    def construct(self):
        # 创建矩阵
        matrix_a = VGroup(
            Text("2  1"),
            Text("1  3")
        ).arrange(DOWN)
        matrix_a.add(SurroundingRectangle(matrix_a))

        matrix_b = VGroup(
            Text("1"),
            Text("2")
        ).arrange(DOWN)
        matrix_b.add(SurroundingRectangle(matrix_b))

        # 创建乘号和等号
        times = Text("x")
        equals = Text("=")

        # 创建结果矩阵
        result = VGroup(
            Text("4"),
            Text("7")
        ).arrange(DOWN)
        result.add(SurroundingRectangle(result))

        # 定位所有内容
        equation = VGroup(
            matrix_a, times, matrix_b,
            equals, result
        ).arrange(RIGHT)

        # 创建逐步计算
        calc1 = Text("= [2(1) + 1(2)]")
        calc2 = Text("= [2 + 2]")
        calc3 = Text("= [4]")

        calcs = VGroup(calc1, calc2, calc3).arrange(DOWN)
        calcs.next_to(equation, DOWN, buff=1)

        # 创建动画
        self.play(Create(matrix_a))
        self.play(Create(matrix_b))
        self.play(Write(times), Write(equals))
        self.play(Create(result))
        self.wait()

        self.play(Write(calc1))
        self.play(Write(calc2))
        self.play(Write(calc3))
        self.wait()
`;
}

export function generateEigenvalueCode(): string {
  return `from manim import *

class MainScene(Scene):
    def construct(self):
        # 创建矩阵和向量
        matrix = VGroup(
            Text("2  1"),
            Text("1  2")
        ).arrange(DOWN)
        matrix.add(SurroundingRectangle(matrix))

        vector = VGroup(
            Text("v1"),
            Text("v2")
        ).arrange(DOWN)
        vector.add(SurroundingRectangle(vector))

        # 创建 lambda 和等式
        lambda_text = Text("lambda")
        equation = Text("Av = lambda v")

        # 定位所有内容
        group = VGroup(matrix, vector, lambda_text, equation).arrange(RIGHT)
        group.to_edge(UP)

        # 创建特征方程步骤
        char_eq = Text("det(A - lambda I) = 0")
        expanded = Text("|2-lambda  1|")
        expanded2 = Text("|1  2-lambda|")
        solved = Text("(2-lambda)^2 - 1 = 0")
        result = Text("lambda = 1, 3")

        # 定位步骤
        steps = VGroup(
            char_eq, expanded, expanded2,
            solved, result
        ).arrange(DOWN)
        steps.next_to(group, DOWN, buff=1)

        # 创建动画
        self.play(Create(matrix), Create(vector))
        self.play(Write(lambda_text), Write(equation))
        self.wait()

        self.play(Write(char_eq))
        self.play(Write(expanded), Write(expanded2))
        self.play(Write(solved))
        self.play(Write(result))
        self.wait()
`;
}

export function generateComplexCode(): string {
  return `from manim import *

class MainScene(Scene):
    def construct(self):
        # 设置平面
        plane = ComplexPlane()
        self.play(Create(plane))

        # 创建复数
        z = 3 + 2j
        dot = Dot([3, 2, 0], color=YELLOW)

        # 创建向量和标签
        vector = Arrow(
            ORIGIN, dot.get_center(),
            buff=0, color=YELLOW
        )
        re_line = DashedLine(
            ORIGIN, [3, 0, 0], color=BLUE
        )
        im_line = DashedLine(
            [3, 0, 0], [3, 2, 0], color=RED
        )

        # 添加标签
        z_label = Text("z = 3 + 2i", font_size=36)
        z_label.next_to(dot, UR)
        re_label = Text("Re(z) = 3", font_size=36)
        re_label.next_to(re_line, DOWN)
        im_label = Text("Im(z) = 2", font_size=36)
        im_label.next_to(im_line, RIGHT)

        # 动画
        self.play(Create(vector))
        self.play(Write(z_label))
        self.wait()
        self.play(
            Create(re_line),
            Create(im_line)
        )
        self.play(
            Write(re_label),
            Write(im_label)
        )
        self.wait()
`;
}

export function generateDiffEqCode(): string {
  return `from manim import *
import numpy as np

class MainScene(Scene):
    def construct(self):
        # 创建微分方程
        eq = MathTex(r"\\frac{dy}{dx} + 2y = e^x")

        # 解题步骤
        step1 = MathTex(r"y = e^{-2x}\\int e^x \\cdot e^{2x} dx")
        step2 = MathTex(r"y = e^{-2x}\\int e^{3x} dx")
        step3 = MathTex(r"y = e^{-2x} \\cdot \\frac{1}{3}e^{3x} + Ce^{-2x}")
        step4 = MathTex(r"y = \\frac{1}{3}e^x + Ce^{-2x}")

        # 排列方程
        VGroup(
            eq, step1, step2, step3, step4
        ).arrange(DOWN, buff=0.5)

        # 创建图形
        axes = Axes(
            x_range=[-2, 2],
            y_range=[-2, 2],
            axis_config={"include_tip": True}
        )

        # 绘制特解（C=0）
        graph = axes.plot(
            lambda x: (1/3)*np.exp(x),
            color=YELLOW
        )

        # 动画
        self.play(Write(eq))
        self.wait()
        self.play(Write(step1))
        self.wait()
        self.play(Write(step2))
        self.wait()
        self.play(Write(step3))
        self.wait()
        self.play(Write(step4))
        self.wait()

        # 显示图形
        self.play(
            FadeOut(VGroup(eq, step1, step2, step3, step4))
        )
        self.play(Create(axes), Create(graph))
        self.wait()
`;
}

export function generateTrigCode(): string {
  return `from manim import *

class MainScene(Scene):
    def construct(self):
        # 创建坐标平面
        plane = NumberPlane(
            x_range=[-4, 4],
            y_range=[-2, 2],
            axis_config={"include_tip": True}
        )

        # 添加自定义标签
        x_label = Text("x").next_to(plane.x_axis.get_end(), RIGHT)
        y_label = Text("y").next_to(plane.y_axis.get_end(), UP)

        # 创建单位圆
        circle = Circle(radius=1, color=BLUE)

        # 创建角度追踪器
        theta = ValueTracker(0)

        # 创建在圆上移动的点
        dot = always_redraw(
            lambda: Dot(
                circle.point_at_angle(theta.get_value()),
                color=YELLOW
            )
        )

        # 创建显示正弦和余弦的线条
        x_line = always_redraw(
            lambda: Line(
                start=[circle.point_at_angle(theta.get_value())[0], 0, 0],
                end=circle.point_at_angle(theta.get_value()),
                color=GREEN
            )
        )

        y_line = always_redraw(
            lambda: Line(
                start=[0, 0, 0],
                end=[circle.point_at_angle(theta.get_value())[0], 0, 0],
                color=RED
            )
        )

        # 创建标签
        sin_label = Text("sin(theta)").next_to(x_line).set_color(GREEN)
        cos_label = Text("cos(theta)").next_to(y_line).set_color(RED)

        # 将所有内容添加到场景
        self.play(Create(plane), Write(x_label), Write(y_label))
        self.play(Create(circle))
        self.play(Create(dot))
        self.play(Create(x_line), Create(y_line))
        self.play(Write(sin_label), Write(cos_label))

        # 动画角度
        self.play(
            theta.animate.set_value(2*PI),
            run_time=4,
            rate_func=linear
        )
        self.wait()
`;
}

export function generateQuadraticCode(): string {
  return `from manim import *

class MainScene(Scene):
    def construct(self):
        # 创建坐标系
        axes = Axes(
            x_range=[-4, 4],
            y_range=[-2, 8],
            axis_config={"include_tip": True}
        )

        # 添加自定义标签
        x_label = Text("x").next_to(axes.x_axis.get_end(), RIGHT)
        y_label = Text("y").next_to(axes.y_axis.get_end(), UP)

        # 创建二次函数
        def func(x):
            return x**2

        graph = axes.plot(
            func,
            color=BLUE,
            x_range=[-3, 3]
        )

        # 创建标签和方程
        equation = Text("f(x) = x^2").to_corner(UL)

        # 创建点和值追踪器
        x = ValueTracker(-3)
        dot = always_redraw(
            lambda: Dot(
                axes.c2p(
                    x.get_value(),
                    func(x.get_value())
                ),
                color=YELLOW
            )
        )

        # 创建显示 x 和 y 值的线条
        v_line = always_redraw(
            lambda: axes.get_vertical_line(
                axes.input_to_graph_point(
                    x.get_value(),
                    graph
                ),
                color=RED
            )
        )
        h_line = always_redraw(
            lambda: axes.get_horizontal_line(
                axes.input_to_graph_point(
                    x.get_value(),
                    graph
                ),
                color=GREEN
            )
        )

        # 将所有内容添加到场景
        self.play(Create(axes), Write(x_label), Write(y_label))
        self.play(Create(graph))
        self.play(Write(equation))
        self.play(Create(dot), Create(v_line), Create(h_line))

        # 动画 x 值
        self.play(
            x.animate.set_value(3),
            run_time=6,
            rate_func=there_and_back
        )
        self.wait()
`;
}

export function generateBasicVisualizationCode(): string {
  return `from manim import *
import numpy as np

class MainScene(Scene):
    def construct(self):
        # 创建标题
        title = Text("Mathematical Visualization", font_size=36).to_edge(UP)

        # 创建坐标轴
        axes = Axes(
            x_range=[-5, 5, 1],
            y_range=[-3, 3, 1],
            axis_config={"include_tip": True},
            x_length=10,
            y_length=6
        )

        # 添加标签
        x_label = Text("x", font_size=24).next_to(axes.x_axis.get_end(), RIGHT)
        y_label = Text("y", font_size=24).next_to(axes.y_axis.get_end(), UP)

        # 创建函数图形
        sin_graph = axes.plot(lambda x: np.sin(x), color=BLUE)
        cos_graph = axes.plot(lambda x: np.cos(x), color=RED)

        # 创建函数标签
        sin_label = Text("sin(x)", font_size=24, color=BLUE).next_to(sin_graph, UP)
        cos_label = Text("cos(x)", font_size=24, color=RED).next_to(cos_graph, DOWN)

        # 创建移动的点
        moving_dot = Dot(color=YELLOW)
        moving_dot.move_to(axes.c2p(-5, 0))

        # 创建点的路径
        path = VMobject()
        path.set_points_smoothly([
            axes.c2p(x, np.sin(x))
            for x in np.linspace(-5, 5, 100)
        ])

        # 动画所有内容
        self.play(Write(title))
        self.play(Create(axes), Write(x_label), Write(y_label))
        self.play(Create(sin_graph), Write(sin_label))
        self.play(Create(cos_graph), Write(cos_label))
        self.play(Create(moving_dot))

        # 动画点沿正弦曲线移动
        self.play(
            MoveAlongPath(moving_dot, path),
            run_time=3,
            rate_func=linear
        )

        # 最后暂停
        self.wait()
`;
}