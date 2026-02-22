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

