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

